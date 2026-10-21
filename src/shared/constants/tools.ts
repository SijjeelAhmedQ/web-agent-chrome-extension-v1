/**
 * The built-in tool catalogue as the UI sees it (names, plain-language descriptions,
 * categories). Implementations live in agent/tools — this file has no runtime deps so
 * every page can import it.
 */

export type ToolCategory = 'read' | 'interact' | 'navigate' | 'tabs';

/** read: never changes anything · action: changes the page · sensitive: may need approval */
export type ToolRisk = 'read' | 'action' | 'sensitive';

export interface ToolMeta {
  id: string;
  label: string;
  description: string;
  category: ToolCategory;
  risk: ToolRisk;
  icon: string;
}

export const TOOL_CATEGORIES: Record<ToolCategory, { label: string; description: string }> = {
  read: { label: 'Reading', description: 'Look at the page without changing anything' },
  interact: { label: 'Interacting', description: 'Click, type and choose on the page' },
  navigate: { label: 'Navigating', description: 'Move between pages' },
  tabs: { label: 'Tabs', description: 'Open, switch and close tabs' },
};

export const BUILT_IN_TOOLS: ToolMeta[] = [
  { id: 'read_page', label: 'Read page', description: 'Understands the page: its text, buttons, links, fields and tables.', category: 'read', risk: 'read', icon: 'ScanText' },
  { id: 'find_element', label: 'Find on page', description: 'Finds a button, field or link by description, like “search box”.', category: 'read', risk: 'read', icon: 'Search' },
  { id: 'scroll', label: 'Scroll', description: 'Scrolls the page or brings something into view.', category: 'read', risk: 'read', icon: 'ArrowDownUp' },
  { id: 'wait', label: 'Wait', description: 'Waits for the page to finish loading or for text to appear.', category: 'read', risk: 'read', icon: 'Hourglass' },
  { id: 'click', label: 'Click', description: 'Clicks buttons, links, tabs, checkboxes and menu items.', category: 'interact', risk: 'sensitive', icon: 'MousePointerClick' },
  { id: 'type', label: 'Type', description: 'Types into text fields, search boxes and editors.', category: 'interact', risk: 'action', icon: 'Keyboard' },
  { id: 'clear', label: 'Clear field', description: 'Empties a text field.', category: 'interact', risk: 'action', icon: 'Eraser' },
  { id: 'select_option', label: 'Choose option', description: 'Picks an option from a dropdown list.', category: 'interact', risk: 'action', icon: 'ListChecks' },
  { id: 'click_text', label: 'Click text', description: 'Clicks visible text that isn’t a button or link — like a name in a table.', category: 'interact', risk: 'sensitive', icon: 'TextSelect' },
  { id: 'read_table', label: 'Read list', description: 'Reads a list or table on the page — every row, and which rows are shown in red or another colour — to count or sort them without opening each one.', category: 'read', risk: 'read', icon: 'ListChecks' },
  { id: 'read_records', label: 'Read records', description: 'Opens the records of a list one after another and reads them all in one step — for reviewing an inbox.', category: 'read', risk: 'action', icon: 'Layers' },
  { id: 'hover', label: 'Hover', description: 'Moves the mouse over something without clicking — opens hover menus, tooltips and previews.', category: 'interact', risk: 'read', icon: 'MousePointer2' },
  { id: 'open_menu', label: 'Open menu', description: 'Opens nested menus level by level, like Products › Laptops › Gaming.', category: 'interact', risk: 'read', icon: 'ListTree' },
  { id: 'press_key', label: 'Press key', description: 'Presses keys like Enter, Escape, Tab or the arrow keys.', category: 'interact', risk: 'sensitive', icon: 'CornerDownLeft' },
  { id: 'navigate', label: 'Go to address', description: 'Opens a web address in the current tab.', category: 'navigate', risk: 'read', icon: 'Globe' },
  { id: 'go_back', label: 'Back', description: 'Goes back to the previous page.', category: 'navigate', risk: 'read', icon: 'ArrowLeft' },
  { id: 'go_forward', label: 'Forward', description: 'Goes forward to the next page.', category: 'navigate', risk: 'read', icon: 'ArrowRight' },
  { id: 'list_tabs', label: 'See tabs', description: 'Sees which tabs are open in this window.', category: 'tabs', risk: 'read', icon: 'Layers' },
  { id: 'open_tab', label: 'Open tab', description: 'Opens a new tab and works there.', category: 'tabs', risk: 'read', icon: 'SquarePlus' },
  { id: 'switch_tab', label: 'Switch tab', description: 'Moves to another open tab.', category: 'tabs', risk: 'read', icon: 'ArrowLeftRight' },
  { id: 'close_tab', label: 'Close tab', description: 'Closes a tab the agent no longer needs.', category: 'tabs', risk: 'action', icon: 'SquareX' },
];

export const BUILT_IN_TOOL_IDS = BUILT_IN_TOOLS.map((t) => t.id);

/** The tools that existed before hover/open_menu — used to add new tools to saved agents. */
export const LEGACY_TOOL_IDS = BUILT_IN_TOOL_IDS.filter((id) => id !== 'hover' && id !== 'open_menu' && id !== 'click_text');
export const READ_ONLY_TOOL_IDS = BUILT_IN_TOOLS.filter((t) => t.risk === 'read').map((t) => t.id);

export const toolMeta = (id: string): ToolMeta | undefined => BUILT_IN_TOOLS.find((t) => t.id === id);

export const CUSTOM_PREFIX = 'custom:';
