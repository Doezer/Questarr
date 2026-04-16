import { EventEmitter } from "events";

export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(1); // Exactly one listener registered in socket.ts
