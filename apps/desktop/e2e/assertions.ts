import { expect, type Page } from "@playwright/test";

/** Prose is readable content, not part of the separate Edit control. */
export function markdownReadView(page: Page, label: string) {
  return page
    .locator(".markdown-field")
    .filter({
      has: page.getByRole("button", { name: `Edit ${label}`, exact: true }),
    })
    .locator(".markdown-field-view");
}

/** Only the concise notice summary is live, not its optional details/actions. */
export async function expectPoliteNotice(page: Page, text: string) {
  const summary = page
    .getByRole("region", { name: "Notifications", exact: true })
    .getByRole("status")
    .filter({ hasText: text });
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("aria-live", "polite");
  await expect(summary).toContainText(text);
}
