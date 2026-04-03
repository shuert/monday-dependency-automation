const {
  getSuccessorItemIds,
  getItemStatus,
  setItemStatus,
} = require("./mondayClient");

const DONE_LABEL = "Done";
const ACTIVATE_LABEL = "Working on it";

/**
 * Normalize IDs from recipe input fields (number, string, or { id }).
 */
function pickId(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value.id != null) return String(value.id);
  return String(value);
}

/**
 * Core logic: parent item just became Done — activate successor items' status.
 * @param {object} opts
 * @param {string|number} opts.boardId
 * @param {string|number} opts.itemId - completed item (parent)
 * @param {string} opts.columnId - status column id
 * @param {string} [opts.authToken] - shortLivedToken for recipe path; omit for API webhook (uses env token)
 */
async function activateSuccessorsForCompletedItem({
  boardId,
  itemId,
  columnId,
  authToken,
  pulseName,
}) {
  const b = String(boardId);
  const i = String(itemId);
  const c = String(columnId);

  const nameHint = pulseName ? ` ("${pulseName}")` : "";
  console.log(`Item ${i}${nameHint} on board ${b} marked Done. Finding successors...`);

  const successorIds = await getSuccessorItemIds(b, i, authToken);

  if (successorIds.length === 0) {
    console.log(`No successor items found for item ${i}.`);
    return;
  }

  console.log(`Found ${successorIds.length} successor(s): ${successorIds.join(", ")}`);

  for (const depId of successorIds) {
    const currentStatus = await getItemStatus(depId, c, authToken);
    console.log(`  Item ${depId} current status: "${currentStatus}"`);

    if (currentStatus === DONE_LABEL) {
      console.log(`  Skipping item ${depId} — already Done.`);
      continue;
    }

    console.log(`  Updating item ${depId} → "${ACTIVATE_LABEL}"`);
    await setItemStatus(b, depId, c, ACTIVATE_LABEL, authToken);
    console.log(`  ✓ Item ${depId} updated successfully.`);
  }
}

/**
 * Classic API webhook: change_column_value event payload.
 */
async function handleStatusChangedToDone(payload) {
  const event = payload?.event;
  if (!event) {
    console.log("No event in payload, skipping");
    return;
  }

  if (event.columnType && event.columnType !== "color") {
    console.log(`Ignoring non-status column change: ${event.columnTitle} (${event.columnType})`);
    return;
  }

  const newLabel = event.value?.label?.text || event.value?.label;
  if (newLabel !== DONE_LABEL) {
    console.log(`Status changed to "${newLabel}", not "${DONE_LABEL}" — skipping`);
    return;
  }

  const boardId = event.boardId;
  const itemId = event.pulseId || event.itemId;
  const columnId = event.columnId;

  if (!boardId || !itemId || !columnId) {
    console.error("Payload missing required fields (boardId, pulseId/itemId, columnId)");
    return;
  }

  await activateSuccessorsForCompletedItem({
    boardId,
    itemId,
    columnId,
    authToken: undefined,
    pulseName: event.pulseName,
  });
}

/**
 * Integration recipe custom action: JWT verified; use shortLivedToken for API.
 * Trigger should be "status changes to Done"; map trigger outputs → action inputs:
 *   boardId, itemId (or pulseId), columnId
 */
async function handleIntegrationRecipeAction(body, req) {
  const token = req.mondayJwt?.shortLivedToken;
  if (!token) {
    console.error("Integration action: missing shortLivedToken in JWT");
    return;
  }

  const p = body?.payload || {};
  const raw = {
    ...(typeof p.inboundFieldValues === "object" ? p.inboundFieldValues : {}),
    ...(typeof p.inputFields === "object" ? p.inputFields : {}),
  };

  const boardId = pickId(raw.boardId);
  const itemId = pickId(raw.itemId ?? raw.pulseId);
  const columnId = pickId(raw.columnId);

  if (!boardId || !itemId || !columnId) {
    console.error(
      "Recipe action missing boardId / itemId / columnId. In Developer Center → Workflow Block → add input fields (Trigger Output): boardId, itemId, columnId and wire them in the recipe.",
      "Received keys:",
      Object.keys(raw)
    );
    return;
  }

  await activateSuccessorsForCompletedItem({
    boardId,
    itemId,
    columnId,
    authToken: token,
  });
}

function isIntegrationActionPayload(body) {
  return body?.payload?.blockKind === "action";
}

module.exports = {
  handleStatusChangedToDone,
  handleIntegrationRecipeAction,
  isIntegrationActionPayload,
  activateSuccessorsForCompletedItem,
};
