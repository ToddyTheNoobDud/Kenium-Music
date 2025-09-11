import process from 'node:process';
import QuickLRU from 'quick-lru';
import { createEvent, Embed } from 'seyfert';
import { getChannelIds, isTwentyFourSevenEnabled } from '../utils/db_helper';

// Constants
const NO_SONG_TIMEOUT = 600_000;
const REJOIN_DELAY = 5_000;
const PLAYER_STATE = {
  IDLE: 0b0001,
  PLAYING: 0b0010,
  REJOINING: 0b0100,
  DESTROYING: 0b1000,
} as const;

// Utility functions
const Utils = {
  addUnrefTimeout(fn: () => void, delay: number): NodeJS.Timeout {
    const t = setTimeout(fn, delay);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    return t;
  },

  async fetchGuildCached(
    cache: QuickLRU<string, any>,
    client: any,
    guildId: string
  ): Promise<any> {
    const cached = cache.get(guildId);
    if (cached) return cached;

    const fromCache = client.cache?.guilds?.get?.(guildId);
    if (fromCache) {
      cache.set(guildId, fromCache);
      return fromCache;
    }

    const fetched = await client.guilds?.fetch?.(guildId).catch(() => null);
    if (fetched) cache.set(guildId, fetched);
    return fetched;
  },

  getVoiceAndTextIds(
    guildId: string,
    voiceId?: string | null,
    textId?: string | null
  ): { v: string; t: string } | null {
    if (voiceId && textId) return { v: voiceId, t: textId };

    const ids = getChannelIds(guildId);
    if (!ids?.voiceChannelId || !ids?.textChannelId) return null;
    return { v: ids.voiceChannelId, t: ids.textChannelId };
  },

  getBotId(client: any): string | undefined {
    return client.me?.id || client.user?.id || client.bot?.id;
  },

  safeDeleteMessage(msg: any): void {
    if (msg?.delete) msg.delete().catch(() => null);
  },
};

// Circuit Breaker with exponential backoff
class CircuitBreaker {
  private failures = new QuickLRU<string, number>({ maxSize: 1000 });
  private lastAttempt = new QuickLRU<string, number>({ maxSize: 1000 });
  private readonly threshold = 3;
  private readonly baseResetTime = 30_000;

  canAttempt(guildId: string): boolean {
    const failures = this.failures.get(guildId) ?? 0;
    const lastAttempt = this.lastAttempt.get(guildId) ?? 0;

    if (failures >= this.threshold) {
      const resetTime = this.baseResetTime * Math.pow(2, failures - this.threshold);
      if (Date.now() - lastAttempt > resetTime) {
        this.failures.delete(guildId);
        this.lastAttempt.delete(guildId);
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(guildId: string): void {
    this.failures.delete(guildId);
    this.lastAttempt.delete(guildId);
  }

  recordFailure(guildId: string): void {
    this.failures.set(guildId, (this.failures.get(guildId) ?? 0) + 1);
    this.lastAttempt.set(guildId, Date.now());
  }
}

// Optimized Timeout Heap with unref support
class TimeoutHeap {
  private heap: Array<{ guildId: string; expiry: number; callback: () => void }> = [];
  private positions = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  add(guildId: string, callback: () => void, delay: number): void {
    this.remove(guildId);
    const entry = { guildId, expiry: Date.now() + delay, callback };
    this.heap.push(entry);
    const index = this.heap.length - 1;
    this.positions.set(guildId, index);
    this.bubbleUp(index);
    this.scheduleNext();
  }

  remove(guildId: string): void {
    const index = this.positions.get(guildId);
    if (index === undefined) return;

    const last = this.heap.pop();
    if (last && index < this.heap.length) {
      this.heap[index] = last;
      this.positions.set(last.guildId, index);
      this.bubbleUp(index);
      this.bubbleDown(index);
    }
    this.positions.delete(guildId);
    this.scheduleNext();
  }

  clearAll(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.heap = [];
    this.positions.clear();
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.heap[parent].expiry <= this.heap[index].expiry) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    for (;;) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < this.heap.length && this.heap[left].expiry < this.heap[smallest].expiry)
        smallest = left;
      if (right < this.heap.length && this.heap[right].expiry < this.heap[smallest].expiry)
        smallest = right;
      if (smallest === index) break;

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const a = this.heap[i];
    const b = this.heap[j];
    this.heap[i] = b;
    this.heap[j] = a;
    this.positions.set(this.heap[i].guildId, i);
    this.positions.set(this.heap[j].guildId, j);
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.heap.length === 0) return;

    const next = this.heap[0];
    const delay = Math.max(0, next.expiry - Date.now());
    this.timer = Utils.addUnrefTimeout(() => {
      this.timer = null;
      if (this.heap[0] === next) {
        this.remove(next.guildId);
        next.callback();
      }
      this.scheduleNext();
    }, delay);
  }
}

// Object Pool for connection configurations
class ConnectionPool {
  private pool: any[] = [];
  private readonly maxSize = 50;

  acquire(config: any): any {
    const obj = this.pool.pop() || {};
    return Object.assign(obj, config);
  }

  release(obj: any): void {
    if (this.pool.length < this.maxSize) {
      for (const key in obj) delete obj[key];
      Object.setPrototypeOf(obj, Object.prototype);
      this.pool.push(obj);
    }
  }
}

// State Machine with validation
class PlayerStateMachine {
  private states = new QuickLRU<string, number>({ maxSize: 5000 });
  private readonly transitions = new Map<number, Set<number>>([
    [PLAYER_STATE.IDLE, new Set([PLAYER_STATE.PLAYING, PLAYER_STATE.DESTROYING])],
    [PLAYER_STATE.PLAYING, new Set([PLAYER_STATE.IDLE, PLAYER_STATE.DESTROYING])],
    [PLAYER_STATE.REJOINING, new Set([PLAYER_STATE.PLAYING, PLAYER_STATE.IDLE])],
    [PLAYER_STATE.DESTROYING, new Set([PLAYER_STATE.REJOINING])],
  ]);

  canTransition(guildId: string, to: number): boolean {
    const cur = this.states.get(guildId) ?? PLAYER_STATE.IDLE;
    return this.transitions.get(cur)?.has(to) ?? false;
  }

  transition(guildId: string, to: number): boolean {
    if (!this.canTransition(guildId, to)) return false;
    this.states.set(guildId, to);
    return true;
  }

  getState(guildId: string): number {
    return this.states.get(guildId) ?? PLAYER_STATE.IDLE;
  }

  clear(guildId: string): void {
    this.states.delete(guildId);
  }
}

// Event Debouncer with unref and eviction
class EventDebouncer {
  private pending = new QuickLRU<string, { timer: NodeJS.Timeout; events: any[] }>({
    maxSize: 1000,
    onEviction: (_key, value) => {
      if (value?.timer) clearTimeout(value.timer);
    },
  });
  private readonly delay = 100;

  debounce(key: string, event: any, handler: (events: any[]) => void): void {
    const existing = this.pending.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.events.push(event);
      existing.timer = Utils.addUnrefTimeout(() => {
        const data = this.pending.get(key);
        this.pending.delete(key);
        if (data) handler(data.events);
      }, this.delay);
      return;
    }

    this.pending.set(key, {
      events: [event],
      timer: Utils.addUnrefTimeout(() => {
        const data = this.pending.get(key);
        this.pending.delete(key);
        if (data) handler(data.events);
      }, this.delay),
    });
  }

  cleanup(): void {
    for (const [_k, v] of this.pending.entries()) {
      if (v?.timer) clearTimeout(v.timer);
    }
    this.pending.clear();
  }
}

// Hybrid Voice Manager
class HybridVoiceManager {
  private static instance: HybridVoiceManager;
  private timeoutHeap = new TimeoutHeap();
  private circuitBreaker = new CircuitBreaker();
  private connectionPool = new ConnectionPool();
  private stateMachine = new PlayerStateMachine();
  private debouncer = new EventDebouncer();
  private channelCache = new QuickLRU<string, any>({ maxSize: 2000 });
  private registeredClients = new WeakSet<any>();

  static getInstance(): HybridVoiceManager {
    if (!HybridVoiceManager.instance) {
      HybridVoiceManager.instance = new HybridVoiceManager();
    }
    return HybridVoiceManager.instance;
  }

  registerListeners(client: any): void {
    if (this.registeredClients.has(client)) return;
    this.registeredClients.add(client);
    const aqua = client.aqua;

    const trackStartHandler = (player: any) => {
      this.stateMachine.transition(player.guildId, PLAYER_STATE.PLAYING);
      this.timeoutHeap.remove(player.guildId);
    };

    const queueEndHandler = (player: any) => {
      this.stateMachine.transition(player.guildId, PLAYER_STATE.IDLE);
      if (!isTwentyFourSevenEnabled(player.guildId)) {
        this.scheduleInactiveHandler(client, player);
      }
    };

    const playerDestroyHandler = (player: any) => {
      if (!player?.guildId) return;
      this.stateMachine.transition(player.guildId, PLAYER_STATE.DESTROYING);
      this.timeoutHeap.remove(player.guildId);

      if (isTwentyFourSevenEnabled(player.guildId)) {
        this.scheduleRejoin(client, player.guildId, player.voiceChannel, player.textChannel);
      } else {
        this.stateMachine.clear(player.guildId);
      }
    };

    aqua.on('trackStart', trackStartHandler);
    aqua.on('queueEnd', queueEndHandler);
    aqua.on('playerDestroy', playerDestroyHandler);

    client._voiceManagerHandlers = {
      trackStart: trackStartHandler,
      queueEnd: queueEndHandler,
      playerDestroy: playerDestroyHandler,
    };
  }

  unregisterListeners(client: any): void {
    if (!this.registeredClients.has(client)) return;
    this.registeredClients.delete(client);

    const handlers = client._voiceManagerHandlers;
    if (handlers && client.aqua) {
      client.aqua.off('trackStart', handlers.trackStart);
      client.aqua.off('queueEnd', handlers.queueEnd);
      client.aqua.off('playerDestroy', handlers.playerDestroy);
    }
    delete client._voiceManagerHandlers;
  }

  handleVoiceUpdate(event: any, client: any): void {
    this.debouncer.debounce(event.guildId, event, events => {
      this.processVoiceUpdates(events[events.length - 1], client);
    });
  }

  cleanup(): void {
    this.timeoutHeap.clearAll();
    this.debouncer.cleanup();
    this.channelCache.clear();
  }

  private scheduleRejoin(
    client: any,
    guildId: string,
    voiceId?: string,
    textId?: string
  ): void {
    if (!this.circuitBreaker.canAttempt(guildId)) return;

    const data = { guildId, voiceId, textId };
    this.timeoutHeap.add(guildId, async () => {
      if (!this.stateMachine.transition(data.guildId, PLAYER_STATE.REJOINING)) return;

      try {
        await this.rejoinChannel(client, data.guildId, data.voiceId, data.textId);
        this.circuitBreaker.recordSuccess(data.guildId);
      } catch (error) {
        this.circuitBreaker.recordFailure(data.guildId);
        console.error(`Rejoin failed for ${data.guildId}:`, error);
      }
    }, REJOIN_DELAY);
  }

  private async rejoinChannel(
    client: any,
    guildId: string,
    voiceId?: string | null,
    textId?: string | null
  ): Promise<void> {
    if (client.aqua?.players?.get?.(guildId)) return;

    const pair = Utils.getVoiceAndTextIds(guildId, voiceId, textId);
    if (!pair) return;

    const guild = await Utils.fetchGuildCached(this.channelCache, client, guildId);
    if (!guild) return;

    const voiceChannel =
      guild.channels?.get?.(pair.v) ||
      (await guild.channels?.fetch?.(pair.v).catch(() => null));
    if (!voiceChannel || voiceChannel.type !== 2) return;

    const cfg = this.connectionPool.acquire({
      guildId,
      voiceChannel: pair.v,
      textChannel: pair.t,
      deaf: true,
      defaultVolume: 65,
    });

    await client.aqua.createConnection(cfg);
    this.connectionPool.release(cfg);
    this.stateMachine.transition(guildId, PLAYER_STATE.IDLE);
  }

  private scheduleInactiveHandler(client: any, player: any): void {
    const guildId = player.guildId;
    this.timeoutHeap.add(guildId, async () => {
      const current = client.aqua?.players?.get?.(guildId);
      if (!current || current.playing) return;
      if (isTwentyFourSevenEnabled(guildId)) return;

      await this.sendInactiveMessage(client, current);
      current.destroy();
    }, NO_SONG_TIMEOUT);
  }

  private async sendInactiveMessage(client: any, player: any): Promise<void> {
    if (!player.textChannel) return;

    const embed = new Embed()
      .setColor(0)
      .setDescription(
        'No song added in 10 minutes, disconnecting...\nUse the `/24_7` command to keep the bot in voice channel.'
      )
      .setFooter({ text: 'Automatically destroying player' });

    const msg = await client.messages
      .write(player.textChannel, { embeds: [embed] })
      .catch(() => null);

    if (msg) {
      this.timeoutHeap.add(`msg_${msg.id}`, () => {
        Utils.safeDeleteMessage(msg);
      }, 10_000);
    }
  }

  private processVoiceUpdates(event: any, client: any): void {
    const { newState, oldState } = event;
    const guildId = newState?.guildId;
    if (!guildId || oldState?.channelId === newState?.channelId) return;

    const player = client.aqua?.players?.get?.(guildId);
    const is247 = isTwentyFourSevenEnabled(guildId);

    if (!player && is247) {
      const ids = getChannelIds(guildId);
      if (ids?.voiceChannelId && ids?.textChannelId) {
        this.scheduleRejoin(client, guildId, ids.voiceChannelId, ids.textChannelId);
      }
    }

    if (player && !is247) {
      this.checkVoiceActivity(client, guildId, player);
    }
  }

  private async checkVoiceActivity(
    client: any,
    guildId: string,
    player: any
  ): Promise<void> {
    const voiceId = player?.voiceChannel;
    if (!voiceId) return;

    const guild = await Utils.fetchGuildCached(this.channelCache, client, guildId);
    if (!guild) return;

    const voiceChannel =
      guild.channels?.get?.(voiceId) ||
      (await guild.channels?.fetch?.(voiceId).catch(() => null));
    if (!voiceChannel) return;

    const members = voiceChannel.members || voiceChannel.voiceMembers || voiceChannel?.members?.cache;
    if (!members) return;

    const humanCount = typeof members.filter === 'function'
      ? members.filter((m: any) => !m?.user?.bot).size ?? members.filter((m: any) => !m?.user?.bot).length
      : [...(members.values?.() ?? [])].filter((m: any) => !m?.user?.bot).length;

    if (humanCount === 0) {
      this.scheduleInactiveHandler(client, player);
    } else {
      this.timeoutHeap.remove(guildId);
    }
  }
}

const manager = HybridVoiceManager.getInstance();

export default createEvent({
  data: { name: 'voiceStateUpdate', once: false },
  run: async ([newState, oldState], client) => {
    if (!client.aqua?.players) return;

    const botId = Utils.getBotId(client);
    if (
      (newState?.userId && botId && newState.userId === botId) ||
      (oldState?.userId && botId && oldState.userId === botId) ||
      oldState?.channelId === newState?.channelId
    ) return;

    manager.registerListeners(client);
    manager.handleVoiceUpdate({ newState, oldState, guildId: newState?.guildId ?? oldState?.guildId }, client);
  },
});

process.on('exit', () => manager.cleanup());
process.on('SIGTERM', () => manager.cleanup());
process.on('SIGINT', () => manager.cleanup());