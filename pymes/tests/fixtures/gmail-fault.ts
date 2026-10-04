import type { P01Arm } from "../../src/gmail-fault-injection.js";
import type { gmailRuntime } from "./gmail-runtime.js";
/** Synthetic arm: the test fixture account is owner@example.test and the
 * draft recipient client@example.test; never a real mailbox. */
export const P01_TEST_ARM: P01Arm = {
  version: 1,
  tenant: "agency",
  owner: "owner",
  subject: "M3-C-sintetico-0001",
  to: "client@example.test",
};
export async function approveP01Email(
  f: Awaited<ReturnType<typeof gmailRuntime>>,
  arm: P01Arm = P01_TEST_ARM,
) {
  f.runtime.source.createTask!("agency", "owner", {
    id: "job",
    goal: "Prueba C",
  });
  await f.runtime.source.planTask!("agency", "owner", {
    taskId: "job",
    workflow: "email-lead-v1",
  });
  const email = f.runtime.source.email!;
  email.saveDraft("job", "owner", {
    to: arm.to,
    subject: arm.subject,
    body: "Texto aprobado exactamente para la prueba C.",
    contactId: "test-contact",
  });
  const review = await email.propose("job", "owner");
  await email.decide("job", "owner", {
    bindingHash: review.review!.bindingHash,
    decision: "approved",
  });
}
