import { EventEmitter } from "node:events";

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(20);
