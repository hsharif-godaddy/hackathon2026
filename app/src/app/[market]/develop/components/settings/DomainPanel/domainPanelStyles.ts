export const DOMAIN_PANEL_PAGE_TITLE_STYLE = {
  fontSize: 28,
  fontWeight: 700,
  lineHeight: '28px',
} as const;

export const DOMAIN_PANEL_PAGE_DESCRIPTION_CLASS = '!text-[14px] leading-tight';

export const DOMAIN_PANEL_SECTION_DESCRIPTION_CLASS = '!text-[14px] leading-tight';

export const DOMAIN_PANEL_SECTION_TITLE_CLASS = '!text-[20px] leading-tight';

export const DOMAIN_PANEL_TITLE_STATUS_GAP_CLASS = 'gap-[8px]';

export const DOMAIN_PANEL_TITLE_DESCRIPTION_GAP_CLASS =
  'max-md:gap-1 md:gap-2';

/** 8px less than the previous gap-4 (32px) between header and URL bar / input. */
export const DOMAIN_PANEL_SUBTITLE_INPUT_GAP_CLASS = 'gap-3';

/** 8px less than the default section content gap (16px) between description and fields. */
export const DOMAIN_PANEL_DESCRIPTION_CONTENT_GAP_CLASS = '!gap-[8px]';

export const DOMAIN_PANEL_STATUS_TAG_CLASS =
  'max-md:!text-[10px] !font-bold max-md:leading-none max-md:[&>svg]:![width:12px!important] max-md:[&>svg]:![height:12px!important]';

export const DOMAIN_PANEL_EDIT_BUTTON_CLASS =
  'shrink-0 max-md:!box-border max-md:!h-[32px] max-md:!min-h-[32px] max-md:!max-h-[32px] max-md:!py-[6px] max-md:![padding-inline:12px!important] max-md:!text-sm max-md:!leading-none';
