/**
 * Media understanding, shared by the API and the worker.
 *
 * Its own package because both processes need it for different halves of the
 * job: the API resolves the credential to fail fast before queueing, and the
 * worker does the actual extraction, upload and parsing. Duplicating it would
 * be two places to get a prompt or a cleanup rule wrong.
 */
export * from "./gemini-media-provider"
export * from "./model-key"
export * from "./transcribe-media"
export * from "./transcript-text-ai"
