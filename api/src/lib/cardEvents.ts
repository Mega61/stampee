// Card change notifications. Call `onCardChanged(cardId)` after any change to a
// card's stamps or status is committed (stamp add/remove, redeem, gift, game
// win). It must never block or fail the caller's response.
// OWNER: agent I (wallet sync). Wave 2 stub: no-op.

export const onCardChanged = (_cardId: string): void => {};
