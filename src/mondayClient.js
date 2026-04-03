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
 * Find items that DEPEND ON the given item (successors).
 *
 * monday's Dependency column stores predecessors: if Item B depends on
 * Item A, then Item B's dependency column contains Item A's ID.
 *
 * To find successors of a completed item, we scan all items on the same
 * board and return those whose dependency column includes the completed
 * item's ID.
 */
async function getSuccessorItemIds(boardId, completedItemId) {
  const query = `
    query GetBoardDependencies($boardId: [ID!]!) {
      boards(ids: $boardId) {
        items_page(limit: 500) {
          items {
            id
            column_values(types: dependency) {
              ... on DependencyValue {
                linked_item_ids
              }
            }
          }
        }
      }
    }
  `;

  const data = await mondayRequest(query, { boardId: [String(boardId)] });
  const items = data?.boards?.[0]?.items_page?.items || [];
  const completedId = String(completedItemId);

  const successors = [];
  for (const item of items) {
    for (const col of item.column_values) {
      if (col.linked_item_ids?.includes(completedId)) {
        successors.push(item.id);
        break;
      }
    }
  }
  return successors;
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
 * Delete a webhook subscription by ID.
 */
async function deleteWebhookSubscription(webhookId) {
  const mutation = `
    mutation DeleteWebhook($id: ID!) {
      delete_webhook(id: $id) {
        id
      }
    }
  `;
  return await mondayRequest(mutation, { id: String(webhookId) });
}

/**
 * Find all webhook subscriptions for a board that point to our /webhook URL.
 * Uses the items_page approach since boards.webhooks may not be available.
 */
async function findOurWebhooks(boardId, ourHost) {
  const query = `
    query GetWebhooks($boardId: ID!) {
      webhooks(board_id: $boardId) {
        id
        board_id
        event
        config
      }
    }
  `;

  try {
    const data = await mondayRequest(query, { boardId: String(boardId) });
    const all = data?.webhooks || [];
    if (!ourHost) return all;
    return all.filter((w) => w.config?.includes(ourHost));
  } catch {
    return [];
  }
}

module.exports = {
  getSuccessorItemIds,
  getItemStatus,
  setItemStatus,
  createWebhookSubscription,
  deleteWebhookSubscription,
  findOurWebhooks,
};
