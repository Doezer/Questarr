import { EventEmitter } from "events";

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(0); // No listener warnings for multiple Socket.io connections
