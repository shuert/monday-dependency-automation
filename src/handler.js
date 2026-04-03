const {
  getDependentItemIds,
  getItemStatus,
  setItemStatus,
} = require("./mondayClient");

// The status labels to match — adjust if your board uses different text
const DONE_LABEL = "Done";
const ACTIVATE_LABEL = "Working on it";

/**
 * Handles the automation:
 *   When an item's status changes to "Done",
 *   find its dependent items and set each one to "Working on it"
 *   ONLY IF they are not already set to "Done".
 *
 * @param {object} payload - The parsed webhook payload from monday
 */
async function handleStatusChangedToDone(payload) {
  const event = payload?.event;
  if (!event) {
    console.log("No event in payload, skipping");
    return;
  }

  // Only process status column changes (monday type "color" = status column)
  if (event.columnType && event.columnType !== "color") {
    console.log(`Ignoring non-status column change: ${event.columnTitle} (${event.columnType})`);
    return;
  }

  // Check if the new value is "Done"
  const newLabel = event.value?.label?.text || event.value?.label;
  if (newLabel !== DONE_LABEL) {
    console.log(`Status changed to "${newLabel}", not "${DONE_LABEL}" — skipping`);
    return;
  }

  // monday uses "pulseId" for the item ID in classic webhooks
  const boardId = event.boardId;
  const itemId = event.pulseId || event.itemId;
  const columnId = event.columnId;

  if (!boardId || !itemId || !columnId) {
    console.error("Payload missing required fields (boardId, pulseId/itemId, columnId)");
    return;
  }

  console.log(`Item ${itemId} ("${event.pulseName}") on board ${boardId} changed to Done. Checking dependencies...`);

  const dependentIds = await getDependentItemIds(itemId);

  if (dependentIds.length === 0) {
    console.log(`No dependent items found for item ${itemId}.`);
    return;
  }

  console.log(`Found ${dependentIds.length} dependent item(s): ${dependentIds.join(", ")}`);

  for (const depId of dependentIds) {
    const currentStatus = await getItemStatus(depId, columnId);
    console.log(`  Item ${depId} current status: "${currentStatus}"`);

    if (currentStatus === DONE_LABEL) {
      console.log(`  Skipping item ${depId} — already Done.`);
      continue;
    }

    console.log(`  Updating item ${depId} → "${ACTIVATE_LABEL}"`);
    await setItemStatus(boardId, depId, columnId, ACTIVATE_LABEL);
    console.log(`  ✓ Item ${depId} updated successfully.`);
  }
}

module.exports = { handleStatusChangedToDone };
