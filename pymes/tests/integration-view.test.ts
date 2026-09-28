import assert from "node:assert/strict";
import test from "node:test";
import { makeDemoData } from "../src/fixtures.js";
import { buildIntegrationView, type VerifiedLink } from "../src/integration-view.js";
import type { ExternalCalendarEvent, ExternalContact } from "../src/connectors.js";

const contacts = makeDemoData(new Date("2026-09-28T07:00:00Z")).contacts;
const crmContacts: ExternalContact[] = [
  { provider: "holded", externalId: "h-1", name: "Lucía Moreno" },
  { provider: "holded", externalId: "h-2", name: "Lucía Moreno" }
];
const calendarEvents: ExternalCalendarEvent[] = [
  { provider: "google_calendar", externalId: "g-1", title: "Llamada con Diego Salas",
    startsAt: "2026-09-29T09:00:00+02:00", endsAt: "2026-09-29T09:30:00+02:00", allDay: false },
  { provider: "google_calendar", externalId: "g-2", title: "Llamada con Diego Salas",
    startsAt: "2026-09-29T10:00:00+02:00", endsAt: "2026-09-29T10:30:00+02:00", allDay: false }
];
const verified = (provider: VerifiedLink["provider"], externalId: string,
  localContactId: string): VerifiedLink => ({ provider, externalId, localContactId,
  verifiedBy: "agent-1", verifiedAt: "2026-09-28T07:00:00Z" });

test("same names and titles stay unlinked until explicit verified IDs exist", () => {
  const view = buildIntegrationView({ contacts, crmContacts, calendarEvents, links: [] });
  assert.equal(view.crmByContactId.size, 0);
  assert.equal(view.linkedEvents.length, 0);
  assert.equal(view.unlinkedCrmContacts.length, 2);
  assert.equal(view.unlinkedEvents.length, 2);
});

test("verified IDs link one record while leaving ambiguous peers pending", () => {
  const view = buildIntegrationView({ contacts, crmContacts, calendarEvents, links: [
    verified("holded", "h-1", "contact-lucia"),
    verified("google_calendar", "g-1", "contact-diego")
  ] });
  assert.equal(view.crmByContactId.get("contact-lucia")?.externalId, "h-1");
  assert.equal(view.linkedEvents[0]?.contact.id, "contact-diego");
  assert.deepEqual(view.unlinkedCrmContacts.map(contact => contact.externalId), ["h-2"]);
  assert.deepEqual(view.unlinkedEvents.map(event => event.externalId), ["g-2"]);
});

test("conflicting or unverified identity links fail closed", () => {
  const base = { contacts, crmContacts, calendarEvents };
  assert.throws(() => buildIntegrationView({ ...base, links: [
    verified("holded", "h-1", "contact-lucia"),
    verified("holded", "h-2", "contact-lucia")
  ] }), /CONFLICTING_CRM_LINK/);
  assert.throws(() => buildIntegrationView({ ...base, links: [
    { ...verified("google_calendar", "g-1", "contact-diego"), verifiedBy: "" }
  ] }), /UNVERIFIED_IDENTITY_LINK/);
  assert.throws(() => buildIntegrationView({ ...base, links: [
    verified("google_calendar", "g-1", "missing")
  ] }), /LINKED_LOCAL_CONTACT_NOT_FOUND/);
});
