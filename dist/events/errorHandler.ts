const handleEvent = (type, fn) => {
	process.on(type, fn);
};

const logEvent = (eventType, message, origin) => {
	console.log(`${eventType}: ${message} ${origin}`);
};
handleEvent("unhandledRejection", (reason, origin) => {
	logEvent("Unhandled Rejection", reason, origin);
});
handleEvent("uncaughtException", (error, origin) =>
	logEvent("Uncaught Exception", error, origin),
);
handleEvent("warning", (warning, origin) =>
	logEvent("Warning", warning, origin),
);
handleEvent("rejectionHandled", (promise, origin) =>
	logEvent("Rejection Handled", `Promise: ${promise}`, origin),
);
handleEvent("beforeExit", (code, origin) =>
	logEvent("Before Exit", `Code: ${code}`, origin),
);
handleEvent("exit", (code, origin) =>
	logEvent("Exit", `Code: ${code}`, origin),
);
handleEvent("uncaughtExceptionMonitor", (error, origin) =>
	logEvent("Uncaught Exception Monitor", error, origin),
);

