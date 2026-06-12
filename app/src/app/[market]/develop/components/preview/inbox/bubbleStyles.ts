const BUBBLE_BASE_CLASS = 'rounded-lg px-2 py-1.5 my-0.5';

/** Matches StreamingMessage user role bubble (getMessageClasses). */
export const SENT_BUBBLE_CLASS = `${BUBBLE_BASE_CLASS} border bg-intents-ux-actionHovered-backgroundColor`;

/** Same size/radius as sent; box surface shows it is from the customer. */
export const CUSTOMER_BUBBLE_CLASS = `${BUBBLE_BASE_CLASS} border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-box-backgroundColor`;
