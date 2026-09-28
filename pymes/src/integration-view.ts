import type { Contact } from "./domain.js";
import type { ExternalCalendarEvent, ExternalContact } from "./connectors.js";

export interface VerifiedLink {
  provider: "holded" | "google_calendar";
  externalId: string;
  localContactId: string;
  verifiedBy: string;
  verifiedAt: string;
}

export interface LinkedEvent {
  event: ExternalCalendarEvent;
  contact: Contact;
}

export interface IntegrationView {
  crmByContactId: Map<string, ExternalContact>;
  linkedEvents: LinkedEvent[];
  unlinkedEvents: ExternalCalendarEvent[];
  unlinkedCrmContacts: ExternalContact[];
}

/** Uses only explicit human-verified IDs. Names, titles and times never create links. */
export function buildIntegrationView(input: {
  contacts: readonly Contact[];
  crmContacts: readonly ExternalContact[];
  calendarEvents: readonly ExternalCalendarEvent[];
  links: readonly VerifiedLink[];
}): IntegrationView {
  const localContacts = new Map(input.contacts.map(contact => [contact.id, contact]));
  if (localContacts.size !== input.contacts.length) throw new Error("DUPLICATE_LOCAL_CONTACT");
  const crm = new Map(input.crmContacts.map(contact => [contact.externalId, contact]));
  if (crm.size !== input.crmContacts.length) throw new Error("DUPLICATE_CRM_CONTACT");
  const events = new Map(input.calendarEvents.map(event => [event.externalId, event]));
  if (events.size !== input.calendarEvents.length) throw new Error("DUPLICATE_CALENDAR_EVENT");

  const crmByContactId = new Map<string, ExternalContact>();
  const eventContactIds = new Map<string, string>();
  const usedCrmIds = new Set<string>();
  for (const link of input.links) {
    if (!link.verifiedBy.trim() || Number.isNaN(Date.parse(link.verifiedAt))) {
      throw new Error("UNVERIFIED_IDENTITY_LINK");
    }
    const contact = localContacts.get(link.localContactId);
    if (!contact) throw new Error("LINKED_LOCAL_CONTACT_NOT_FOUND");
    if (link.provider === "holded") {
      const external = crm.get(link.externalId);
      if (!external) throw new Error("LINKED_CRM_CONTACT_NOT_FOUND");
      if (usedCrmIds.has(link.externalId) || crmByContactId.has(contact.id)) {
        throw new Error("CONFLICTING_CRM_LINK");
      }
      usedCrmIds.add(link.externalId);
      crmByContactId.set(contact.id, external);
    } else {
      if (!events.has(link.externalId)) throw new Error("LINKED_CALENDAR_EVENT_NOT_FOUND");
      if (eventContactIds.has(link.externalId)) throw new Error("CONFLICTING_EVENT_LINK");
      eventContactIds.set(link.externalId, contact.id);
    }
  }

  const linkedEvents: LinkedEvent[] = [];
  const unlinkedEvents: ExternalCalendarEvent[] = [];
  for (const event of input.calendarEvents) {
    const contactId = eventContactIds.get(event.externalId);
    if (contactId) linkedEvents.push({ event, contact: localContacts.get(contactId)! });
    else unlinkedEvents.push(event);
  }
  return {
    crmByContactId,
    linkedEvents,
    unlinkedEvents,
    unlinkedCrmContacts: input.crmContacts.filter(contact => !usedCrmIds.has(contact.externalId))
  };
}
