import { safePostMessage } from "./postMessage";

export function send<T extends { type: string }>(msg: T): void {
  safePostMessage(window.parent, msg);
}

const TRACK_EVENT_TYPE = "TRACK_EVENT" as const;

type TrackProperties = Record<string, string | number | boolean>;

export const trackEventBus = {
  click(eid: string, properties?: TrackProperties): void {
    send({ type: TRACK_EVENT_TYPE, kind: "click", eid, properties });
  },
  impression(eid: string, properties?: TrackProperties): void {
    send({ type: TRACK_EVENT_TYPE, kind: "impression", eid, properties });
  },
};
