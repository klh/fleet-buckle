// global-setup.ts — ONE stack boot for the whole run: the full Docker
// Desktop topology (3 units + stubs + jaeger), built from this source.
export { stackUp as default } from "./kit/buckle.kit.stack.ts";
