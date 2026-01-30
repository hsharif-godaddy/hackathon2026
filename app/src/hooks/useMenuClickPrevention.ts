import { useEffect, useRef } from 'react';

/**
 * Hook to prevent menu clicks from bubbling to parent clickable elements.
 *
 * This is useful when using @ux/menu inside clickable containers (like cards, buttons, etc.)
 * where menu item clicks should not trigger the parent's onClick handler.
 *
 * The hook uses a two-tier detection strategy:
 * 1. Ref-based tracking: Tracks recent menu interactions and prevents clicks for a short period
 *    (useful for catching subsequent UI elements like alert buttons that appear after menu actions)
 * 2. Event path detection: Uses composedPath() to detect menu elements even when rendered in portals
 * 
 * Note: The UXCore team has been made aware of this issue and is working on a fix in this Jira ticket:
 * https://godaddy-corp.atlassian.net/browse/UXP-11682. Once the fix is released, this hook can be removed.
 *
 * @returns Object with:
 *   - menuWrapperProps: Props to spread on a wrapper div around the Menu component
 *     (handles early event stopping and ref tracking)
 *   - menuItemProps: Props factory function to add to each MenuItem
 *     (stops propagation and tracks interaction)
 *   - shouldPreventClick: Function to check in parent onClick handler
 *     (returns true if click should be prevented, false otherwise)
 *
 * @example
 * ```tsx
 * const { menuWrapperProps, menuItemProps, shouldPreventClick } = useMenuClickPrevention();
 *
 * return (
 *   <Card onClick={(e) => {
 *     if (shouldPreventClick(e)) return;
 *     // handle card click
 *   }}>
 *     <div {...menuWrapperProps}>
 *       <Menu>
 *         <MenuList>
 *           <MenuItem {...menuItemProps()} onClick={handleAction}>
 *             Action
 *           </MenuItem>
 *         </MenuList>
 *       </Menu>
 *     </div>
 *   </Card>
 * );
 * ```
 */
export function useMenuClickPrevention() {
  const menuInteractionRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const resetRef = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      menuInteractionRef.current = false;
      timeoutRef.current = null;
    }, 500);
  };

  const menuWrapperProps = {
    onMouseDown: (e: React.MouseEvent) => {
      e.stopPropagation();
      menuInteractionRef.current = true;
      resetRef();
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      menuInteractionRef.current = true;
      resetRef();
    }
  };

  const menuItemProps = () => ({
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      menuInteractionRef.current = true;
      resetRef();
    }
  });

  const shouldPreventClick = (e: React.MouseEvent): boolean => {
    if (menuInteractionRef.current) {
      return true;
    }
    
    const nativeEvent = e.nativeEvent as MouseEvent;
    
    if (nativeEvent.composedPath) {
      const path = nativeEvent.composedPath();
      const isMenuClick = path.some((el) => {
        if (el instanceof HTMLElement) {
          const role = el.getAttribute('role');
          return role === 'menu' ||
                 role === 'menuitem' ||
                 role === 'menubutton' ||
                 el.id?.includes('menu') ||
                 el.closest('[id*="menu"]') !== null ||
                 el.closest('[role="menu"]') !== null;
        }
        return false;
      });
      
      if (isMenuClick) {
        return true;
      }
    }

    return false;
  };

  return {
    menuWrapperProps,
    menuItemProps,
    shouldPreventClick
  };
}
