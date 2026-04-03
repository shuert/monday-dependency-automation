const {
  getSuccessorItemIds,
  getItemStatus,
  setItemStatus,
  getBoardIdForItem,
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
 * Status trigger may pass column id as string or inside statusColumnValue JSON.
 */
function extractStatusColumnId(columnId, statusColumnValue) {
  if (columnId != null && columnId !== "") {
    const c = pickId(columnId);
    if (c && c !== "[object Object]") return c;
  }
  const v = statusColumnValue;
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if (v.column_id != null) return String(v.column_id);
    if (v.columnId != null) return String(v.columnId);
    if (v.column?.id != null) return String(v.column.id);
    if (v.id != null && typeof v.id === "string" && !v.label) return String(v.id);
  }
  return null;
}

/**
 * Trigger outputs (new infra): itemId, item, statusColumnValue — not boardId.
 */
function extractItemIdFromRecipe(raw) {
  return (
    pickId(raw.itemId) ||
    pickId(raw.pulseId) ||
    pickId(raw.item?.id) ||
    (typeof raw.item === "number" || typeof raw.item === "string" ? pickId(raw.item) : null)
  );
}

function extractBoardIdFromRecipe(raw) {
  return (
    pickId(raw.boardId) ||
    pickId(raw.item?.board_id) ||
    pickId(raw.item?.boardId) ||
    pickId(raw.item?.board?.id)
  );
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
 * Integration / automations block: JWT + shortLivedToken.
 * "When status changes" trigger exposes: groupId, itemId, userId, statusColumnValue,
 * previousStatusColumnValue, item — not boardId. We resolve board via GraphQL from itemId.
 *
 * Map action inputs from trigger outputs:
 *   itemId ← itemId (or item)
 *   columnId ← statusColumnValue (or a text field wired to column id if monday sends label-only JSON)
 *   boardId ← optional; omitted → fetched with getBoardIdForItem
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

  const itemId = extractItemIdFromRecipe(raw);
  let boardId = extractBoardIdFromRecipe(raw);
  const columnId = extractStatusColumnId(raw.columnId, raw.statusColumnValue);

  if (!itemId) {
    console.error(
      "Recipe action missing itemId. Map trigger output itemId (or item) to your action input.",
      "Received keys:",
      Object.keys(raw)
    );
    return;
  }

  if (!columnId) {
    console.error(
      "Recipe action missing status column id. Map trigger output statusColumnValue to columnId input, or wire column id if your builder exposes it.",
      "statusColumnValue sample:",
      typeof raw.statusColumnValue === "object"
        ? JSON.stringify(raw.statusColumnValue).slice(0, 300)
        : raw.statusColumnValue
    );
    return;
  }

  if (!boardId) {
    boardId = await getBoardIdForItem(itemId, token);
    if (!boardId) {
      console.error("Could not resolve boardId for item", itemId);
      return;
    }
    console.log(`Resolved boardId ${boardId} from item ${itemId}`);
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
