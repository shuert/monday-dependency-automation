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
  const { boardId, itemId, columnId } = extractPayloadFields(payload);

  if (!boardId || !itemId || !columnId) {
    console.error("Payload missing required fields", payload);
    return;
  }

  console.log(`Item ${itemId} on board ${boardId} changed to Done. Checking dependencies...`);

  // 1. Get dependent item IDs from the native Dependency column
  const dependentIds = await getDependentItemIds(itemId);

  if (dependentIds.length === 0) {
    console.log(`No dependent items found for item ${itemId}.`);
    return;
  }

  console.log(`Found ${dependentIds.length} dependent item(s): ${dependentIds.join(", ")}`);

  // 2. For each dependent item, check status and conditionally update
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

/**
 * Extracts the fields we need from the monday webhook payload.
 * monday sends event data in payload.event for integration triggers.
 */
function extractPayloadFields(payload) {
  const event = payload?.event || payload;
  return {
    boardId: event?.boardId,
    itemId: event?.itemId,
    // The column whose change triggered this — we reuse the same column ID
    // for dependent items since all items share the same board schema
    columnId: event?.columnId,
  };
}

module.exports = { handleStatusChangedToDone };
