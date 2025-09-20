import { cooldownMiddleware } from "./cooldown.middleware";
import { checkPlayer, checkTrack, checkVoice } from "./internals";
export const middlewares = {
	cooldown: cooldownMiddleware,
	checkPlayer,
	checkVoice,
	checkTrack,
};
