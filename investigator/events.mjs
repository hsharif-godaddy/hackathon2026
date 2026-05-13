import { PutObjectCommand } from '@aws-sdk/client-s3';

const MAX_DATA_BYTES = 4 * 1024;
const MAX_STRING_LEN = 512;

function truncateStrings(node, depth = 0) {
  if (depth > 6) return node;
  if (typeof node === 'string') {
    return node.length > MAX_STRING_LEN ? node.slice(0, MAX_STRING_LEN) + '…' : node;
  }
  if (Array.isArray(node)) return node.map((v) => truncateStrings(v, depth + 1));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = truncateStrings(v, depth + 1);
    return out;
  }
  return node;
}

export function createEventEmitter({ s3, bucket, eventsPrefix, investigationId }) {
  if (!eventsPrefix) {
    // Backward-compat during rollout: if BFF didn't pass eventsPrefix, emits
    // become no-ops. Safer than throwing — state.json still works.
    const noop = async () => undefined;
    noop.getSeq = () => 0;
    return noop;
  }

  let seq = 0;
  // Serialize emits so two fire-and-forget callers (stdout phase tap +
  // heartbeat interval) can't race on seq assignment or collide on the
  // same S3 key. Without this, a naive "decrement seq on failure" would
  // let two concurrent emits reserve the same slot. Keeping the queue
  // single-file also makes the decrement-on-failure safe: no later seq
  // has been committed yet when we decide to roll back.
  let queueTail = Promise.resolve();

  async function doEmit(type, data) {
    const reserved = seq + 1;
    let payload = { ...data };
    try {
      let serialized = JSON.stringify(payload);
      if (serialized.length > MAX_DATA_BYTES) {
        payload = truncateStrings(payload);
        serialized = JSON.stringify(payload);
        if (serialized.length > MAX_DATA_BYTES) {
          // Second pass: still over budget after trimming strings. Drop
          // non-primitive fields so the hard cap holds regardless of the
          // input shape.
          const flat = { __truncated: true, __originalBytes: JSON.stringify(data).length };
          for (const [k, v] of Object.entries(payload)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
              flat[k] = v;
            }
          }
          payload = flat;
        } else {
          payload.__truncated = true;
          payload.__originalBytes = JSON.stringify(data).length;
        }
      }
    } catch {
      payload = { __unserializable: true };
    }

    const evt = {
      v: 1,
      seq: reserved,
      investigationId,
      ts: new Date().toISOString(),
      type,
      data: payload,
    };

    const key = `${eventsPrefix}${String(reserved).padStart(6, '0')}.json`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(evt),
          ContentType: 'application/json',
          CacheControl: 'no-store',
        }),
      );
      seq = reserved;
    } catch (err) {
      // Seq stays — next emit reuses this slot, preventing a permanent gap
      // that would stall the contiguous reader. Safe because the queue
      // serializes emits: no higher seq has been PUT yet.
      console.error('[investigator] event emit failed', { key, type, err });
    }
    return evt;
  }

  function emit(type, data = {}) {
    const next = queueTail.then(() => doEmit(type, data));
    queueTail = next.catch(() => {});
    return next;
  }

  emit.getSeq = () => seq;
  return emit;
}
