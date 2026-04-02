const axios = require("axios");

const MONDAY_API_URL = "https://api.monday.com/v2";

/**
 * Execute a GraphQL query/mutation against the monday.com API.
 */
async function mondayRequest(query, variables = {}) {
  const response = await axios.post(
    MONDAY_API_URL,
    { query, variables },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.MONDAY_API_TOKEN,
        "API-Version": "2024-01",
      },
    }
  );

  if (response.data.errors) {
    const msg = response.data.errors.map((e) => e.message).join(", ");
    throw new Error(`monday API error: ${msg}`);
  }

  return response.data.data;
}

/**
 * Get the dependent item IDs from the native Dependency column of an item.
 * Returns an array of item ID strings.
 */
async function getDependentItemIds(itemId) {
  const query = `
    query GetDependencies($itemId: [ID!]!) {
      items(ids: $itemId) {
        column_values(types: dependency) {
          ... on DependencyValue {
            linked_item_ids
          }
        }
      }
    }
  `;

  const data = await mondayRequest(query, { itemId: [String(itemId)] });
  const item = data?.items?.[0];
  if (!item) return [];

  // Collect all linked IDs across all dependency columns (usually just one)
  const ids = [];
  for (const col of item.column_values) {
    if (col.linked_item_ids) {
      ids.push(...col.linked_item_ids);
    }
  }
  return ids;
}

/**
 * Get the current status label of an item's status column.
 * Returns the label string (e.g. "Done", "Working on it") or null.
 */
async function getItemStatus(itemId, statusColumnId) {
  const query = `
    query GetItemStatus($itemId: [ID!]!, $columnId: [String!]!) {
      items(ids: $itemId) {
        column_values(ids: $columnId) {
          ... on StatusValue {
            label
          }
        }
      }
    }
  `;

  const data = await mondayRequest(query, {
    itemId: [String(itemId)],
    columnId: [statusColumnId],
  });

  const label = data?.items?.[0]?.column_values?.[0]?.label;
  return label ?? null;
}

/**
 * Change the status of an item to a given label value.
 * monday requires the column value to be set as JSON: { "label": "..." }
 */
async function setItemStatus(boardId, itemId, statusColumnId, label) {
  const mutation = `
    mutation SetStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId
        item_id: $itemId
        column_id: $columnId
        value: $value
      ) {
        id
      }
    }
  `;

  await mondayRequest(mutation, {
    boardId: String(boardId),
    itemId: String(itemId),
    columnId: statusColumnId,
    value: JSON.stringify({ label }),
  });
}

/**
 * Register a webhook subscription on a board via monday's API.
 * This sends classic webhook payloads with boardId, itemId, columnId.
 */
async function createWebhookSubscription(boardId, webhookUrl) {
  const mutation = `
    mutation CreateWebhook($boardId: ID!, $url: String!, $event: WebhookEventType!) {
      create_webhook(board_id: $boardId, url: $url, event: $event) {
        id
        board_id
      }
    }
  `;

  return await mondayRequest(mutation, {
    boardId: String(boardId),
    url: webhookUrl,
    event: "change_column_value",
  });
}

/**
 * List active webhook subscriptions for a board.
 */
async function listWebhooks(boardId) {
  const query = `
    query GetWebhooks($boardId: [ID!]!) {
      boards(ids: $boardId) {
        webhooks {
          id
          board_id
          event
          config
        }
      }
    }
  `;

  const data = await mondayRequest(query, { boardId: [String(boardId)] });
  return data?.boards?.[0]?.webhooks || [];
}

module.exports = {
  getDependentItemIds,
  getItemStatus,
  setItemStatus,
  createWebhookSubscription,
  listWebhooks,
};
