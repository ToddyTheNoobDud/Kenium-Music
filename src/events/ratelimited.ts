import { createEvent } from "seyfert";

export default createEvent({
    data: { name: 'rateLimited', once: false },
    run: async (data, client) => {
        client.logger.warn(`Im ratelimited!`, data);
    }
});