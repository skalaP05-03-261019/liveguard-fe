// Versions are scoped to an entity, never compared across cases/reviews/messages.
interface EventEnvelope { entityVersion?: unknown; payload?: Record<string, unknown> }
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export class EventVersions {
  private versions = new Map<string, number>();
  clear() { this.versions.clear(); }
  observe(kind: string, id: string, version: unknown) {
    if (integer(version)) this.versions.set(`${kind}:${id}`, Math.max(version, this.version(kind, id) ?? -1));
  }
  version(kind: string, id: string) { return this.versions.get(`${kind}:${id}`); }
  accept(event: string, envelope: EventEnvelope): boolean {
    const p = envelope.payload ?? {};
    let kind: string, id: unknown;
    if (['CHAT', 'MESSAGE_VISIBILITY_CHANGED', 'MESSAGE_RESTORED'].includes(event)) { kind = 'message'; id = p.messageId; }
    else if (['CASE_CREATED', 'CASE_UPDATED'].includes(event)) { kind = 'case'; id = p.caseId; }
    else if (['CONTEXT_REVIEW_REQUIRED', 'KICK_REVIEW_REQUIRED', 'REVIEW_DECIDED'].includes(event)) { kind = 'review'; id = p.reviewId; }
    else if (['ACTION_APPLIED', 'ACTION_FAILED'].includes(event)) { kind = 'action'; id = p.actionId; }
    else return true; // Progress and lifecycle events have no shared case-version ordering.
    const version = integer(envelope.entityVersion) ? envelope.entityVersion : p.version;
    if (typeof id !== 'string' || !integer(version)) return true; // No fabricated versions.
    if (version < (this.version(kind, id) ?? -1)) return false;
    this.observe(kind, id, version);
    return true; // Equal versions may announce updated related state; eventId handles duplicates.
  }
}
