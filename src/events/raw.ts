import { createEvent } from "seyfert";
export default createEvent({
	data: { name: "raw" },
	async run(data, client) {
		if (data.t === "VOICE_SERVER_UPDATE" || data.t === "VOICE_STATE_UPDATE") {
			// @ts-expect-error
			return client.aqua.updateVoiceState({ t: data.t, d: data.d });
		}
	},
});
