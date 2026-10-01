import { makePacket } from './packet.mjs';
self.onmessage = async event => {
  try {
    const { route, photos, options } = event.data;
    const packet = await makePacket(new Uint8Array(route), photos.map(p => ({ name: p.name, bytes: new Uint8Array(p.bytes) })), options);
    self.postMessage({ result: packet.result, zip: packet.zip }, [packet.zip.buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
