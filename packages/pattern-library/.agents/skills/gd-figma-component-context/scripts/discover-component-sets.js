/**
 * discover-component-sets.js
 *
 * Resolves a start node by ID, walks up to find its containing page,
 * then does a shallow traversal (up to two levels of FRAME/SECTION nesting)
 * to collect all COMPONENT_SET nodes within scope.
 *
 * Usage: paste into a use_figma call, replacing '<nodeId>' with the target node ID.
 *
 * Returns: { page, traversalRoot, componentSets[] }
 * Each componentSet entry: { id, name, parent, desc, props[] }
 */

const startNode = figma.getNodeById('<nodeId>');
if (!startNode) return { error: 'Node not found' };

let page = startNode;
while (page && page.type !== 'PAGE') page = page.parent;
if (!page) return { error: 'Could not determine containing page' };
await figma.setCurrentPageAsync(page);

// Traversal is only entered for PAGE, FRAME, SECTION, or COMPONENT_SET roots.
// GROUP nodes are never descended into — not as a root, not as intermediate containers.
const TRAVERSABLE_ROOT_TYPES = new Set(['PAGE', 'FRAME', 'SECTION', 'COMPONENT_SET']);
const CONTAINER_TYPES = new Set(['FRAME', 'SECTION']);

if (!TRAVERSABLE_ROOT_TYPES.has(startNode.type)) {
  return { error: `Cannot traverse node of type ${startNode.type}. Provide a link to a page, frame, section, or component set.` };
}

const root = startNode;

const results = [];
const collect = (node, parentName) => {
  if (node.type !== 'COMPONENT_SET') return;
  const props = Object.entries(node.componentPropertyDefinitions).map(([k, v]) => {
    if (v.type === 'VARIANT') return `${k}: ${v.variantOptions.join(' | ')}`;
    if (v.type === 'BOOLEAN') return `${k}: boolean (default: ${v.defaultValue})`;
    if (v.type === 'TEXT') return `${k}: text`;
    if (v.type === 'INSTANCE_SWAP') return `${k}: instance_swap`;
    return `${k}: ${v.type}`;
  });
  results.push({ id: node.id, name: node.name, parent: parentName, desc: node.description?.slice(0, 100) || '(empty)', props });
};

if (root.type === 'COMPONENT_SET') {
  collect(root, root.parent?.name ?? null);
} else {
  for (const child of root.children || []) {
    collect(child, null);
    if (CONTAINER_TYPES.has(child.type)) {
      for (const gc of child.children || []) {
        collect(gc, child.name);
      }
    }
  }
}

return { page: page.name, traversalRoot: root.name, componentSets: results };
