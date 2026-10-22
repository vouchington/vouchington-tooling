import type { Locator } from '@playwright/test'

/**
 * Opens a Radix UI Select or DropdownMenu by pressing Space on the trigger.
 *
 * Radix portals the dropdown content outside the trigger's DOM subtree, so the
 * trigger must be focused first; Space is the reliable keyboard activation path
 * (ArrowDown also works for DropdownMenu but Space is universal for both).
 *
 * After calling this, wait for the option you want with `toBeAttached()` before
 * clicking — not `toBeVisible()`. Radix items are attached to the DOM immediately
 * but may not pass the visibility check until the CSS animation settles.
 *
 * @example
 * await openRadixDropdown(page.getByTestId('sort-trigger'))
 * await expect(page.getByTestId('sort-option-new')).toBeAttached()
 * await page.getByTestId('sort-option-new').click()
 */
export async function openRadixDropdown(trigger: Locator): Promise<void> {
  await trigger.press(' ')
}
