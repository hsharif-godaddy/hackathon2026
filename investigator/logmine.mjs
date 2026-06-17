// Drain3 log-template miner — pure ESM port of logpai/Drain3 (drain.py + masking.py).
// No I/O, no external deps. Collapses raw log lines into templates + counts so the
// investigation agent reads a compact digest, with rare/novel clusters surfaced.
//
// Pinned 2026-06-10 against logpai/Drain3 master. Defaults match drain3.ini.

/**
 * Default masking instructions, applied IN ORDER (each a global replace), mirroring
 * the shipped examples/drain3.ini. Each regex's zero-width boundary groups
 * `((?<=[^A-Za-z0-9])|^)` ... `((?=[^A-Za-z0-9])|$)` ensure we only mask whole tokens.
 * @returns {Array<{ maskWith: string, regex: RegExp }>}
 */
export function defaultMaskingInstructions() {
  return [
    // --- Airo-tuned rules (from real Loki + ESSP samples, 2026-06-10) ---
    // ORDER MATTERS: greedy/specific shapes first, so the generic NUM/HEX rules
    // below don't shred their digits. URLs contain dots/colons/digits → mask
    // whole; then ISO timestamps; then UUIDs; then bare long hashes
    // (container_id / commit sha — Drain3's stock HEX only catches `0x…`).
    { maskWith: 'URL', regex: /(https?:\/\/[^\s"'<>]+)/g },
    { maskWith: 'TS', regex: /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)/g },
    { maskWith: 'UUID', regex: /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g },
    { maskWith: 'HEX', regex: /((?<=[^A-Za-z0-9])|^)([0-9a-f]{32,})((?=[^A-Za-z0-9])|$)/g },
    // --- Drain3 stock rules (examples/drain3.ini) ---
    { maskWith: 'ID', regex: /((?<=[^A-Za-z0-9])|^)(([0-9a-f]{2,}:){3,}([0-9a-f]{2,}))((?=[^A-Za-z0-9])|$)/g },
    { maskWith: 'IP', regex: /((?<=[^A-Za-z0-9])|^)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})((?=[^A-Za-z0-9])|$)/g },
    { maskWith: 'SEQ', regex: /((?<=[^A-Za-z0-9])|^)([0-9a-f]{6,} ?){3,}((?=[^A-Za-z0-9])|$)/g },
    { maskWith: 'SEQ', regex: /((?<=[^A-Za-z0-9])|^)([0-9A-F]{4} ?){4,}((?=[^A-Za-z0-9])|$)/g },
    { maskWith: 'HEX', regex: /((?<=[^A-Za-z0-9])|^)(0x[a-f0-9A-F]+)((?=[^A-Za-z0-9])|$)/g },
    { maskWith: 'NUM', regex: /((?<=[^A-Za-z0-9])|^)([\-\+]?\d+)((?=[^A-Za-z0-9])|$)/g },
    { maskWith: 'CMD', regex: /(?<=executed cmd )(".+?")/g },
  ];
}

export class LogMasker {
  /**
   * @param {{ maskPrefix?: string, maskSuffix?: string, instructions?: Array<{maskWith:string,regex:RegExp}> }} [opts]
   */
  constructor(opts = {}) {
    this.maskPrefix = opts.maskPrefix ?? '<:';
    this.maskSuffix = opts.maskSuffix ?? ':>';
    this.instructions = opts.instructions ?? defaultMaskingInstructions();
  }

  /**
   * Apply each masking instruction in order. Each replaces every match (global flag)
   * with `${maskPrefix}${maskWith}${maskSuffix}` — matches Drain3 MaskingInstruction.mask.
   * @param {string} content
   * @returns {string}
   */
  mask(content) {
    let out = String(content);
    for (const mi of this.instructions) {
      const replacement = `${this.maskPrefix}${mi.maskWith}${this.maskSuffix}`;
      // RegExp carries the `g` flag; String.replace replaces all matches.
      out = out.replace(mi.regex, replacement);
    }
    return out;
  }
}

/**
 * Split a log line into tokens: trim, then split on any run of whitespace, dropping
 * empties. Matches Drain3 get_content_as_tokens (extra delimiters handled by caller).
 * @param {string} content
 * @param {string[]} [extraDelimiters]
 * @returns {string[]}
 */
export function tokenize(content, extraDelimiters = []) {
  let s = String(content).trim();
  for (const d of extraDelimiters) s = s.split(d).join(' ');
  if (s.length === 0) return [];
  return s.split(/\s+/).filter((t) => t.length > 0);
}

export class LogCluster {
  /**
   * @param {string[]} tokens
   * @param {number} clusterId
   */
  constructor(tokens, clusterId) {
    this.logTemplateTokens = tokens;
    this.clusterId = clusterId;
    this.size = 1;
  }
  getTemplate() {
    return this.logTemplateTokens.join(' ');
  }
}

/**
 * Merge a new token sequence into an existing template: positions that match keep
 * their token; positions that differ become the wildcard. Both arrays MUST be the
 * same length (Drain groups by token count). Matches Drain3 create_template.
 * @param {string[]} contentTokens new line's tokens
 * @param {string[]} templateTokens existing cluster template
 * @param {string} paramStr wildcard sentinel
 * @returns {string[]}
 */
export function createTemplate(contentTokens, templateTokens, paramStr) {
  return contentTokens.map((tok, i) => (tok === templateTokens[i] ? tok : paramStr));
}

export const DRAIN_DEFAULTS = {
  depth: 4,
  simTh: 0.4,
  maxChildren: 100,
  maxClusters: 1000,
  parametrizeNumericTokens: true,
  paramStr: '<:*:>',
  extraDelimiters: [],
};

class Node {
  constructor() {
    /** @type {Map<string, Node>} */
    this.keyToChildNode = new Map();
    /** @type {number[]} */
    this.clusterIds = [];
  }
}

export class Drain {
  /** @param {Partial<typeof DRAIN_DEFAULTS>} [opts] */
  constructor(opts = {}) {
    const o = { ...DRAIN_DEFAULTS, ...opts };
    if (o.depth < 3) throw new Error('depth argument must be at least 3');
    this.logClusterDepth = o.depth;
    this.maxNodeDepth = o.depth - 2; // matches drain.py
    this.simTh = o.simTh;
    this.maxChildren = o.maxChildren;
    this.maxClusters = o.maxClusters;
    this.parametrizeNumericTokens = o.parametrizeNumericTokens;
    this.paramStr = o.paramStr;
    this.extraDelimiters = o.extraDelimiters;
    this.root = new Node();
    /** @type {Map<number, LogCluster>} */
    this.idToCluster = new Map();
    this.clustersCounter = 0;
  }

  /** @returns {LogCluster[]} */
  clusters() {
    return [...this.idToCluster.values()];
  }

  /** @param {string} token */
  hasNumbers(token) {
    return /\d/.test(token);
  }

  /**
   * Token-similarity between an existing template (seq1) and a new line (seq2).
   * Wildcards in the template count toward similarity only when includeParams.
   * @returns {[number, number]} [similarity, paramCount]
   */
  getSeqDistance(seq1, seq2, includeParams) {
    if (seq1.length === 0) return [1.0, 0];
    let simTokens = 0;
    let paramCount = 0;
    for (let i = 0; i < seq1.length; i++) {
      if (seq1[i] === this.paramStr) {
        paramCount += 1;
        continue;
      }
      if (seq1[i] === seq2[i]) simTokens += 1;
    }
    if (includeParams) simTokens += paramCount;
    return [simTokens / seq1.length, paramCount];
  }

  /** Pick the best cluster among candidates by similarity, tie-broken by param count. */
  fastMatch(clusterIds, tokens, simTh, includeParams) {
    let maxSim = -1;
    let maxParamCount = -1;
    let maxCluster = null;
    for (const id of clusterIds) {
      const cluster = this.idToCluster.get(id);
      if (!cluster) continue;
      const [curSim, paramCount] = this.getSeqDistance(cluster.logTemplateTokens, tokens, includeParams);
      if (curSim > maxSim || (curSim === maxSim && paramCount > maxParamCount)) {
        maxSim = curSim;
        maxParamCount = paramCount;
        maxCluster = cluster;
      }
    }
    return maxSim >= simTh ? maxCluster : null;
  }

  /** Descend the tree by token-count then leading tokens; match a leaf cluster. */
  treeSearch(tokens, simTh, includeParams) {
    const tokenCount = tokens.length;
    let curNode = this.root.keyToChildNode.get(String(tokenCount));
    if (!curNode) return null;
    if (tokenCount === 0) return this.idToCluster.get(curNode.clusterIds[0]) ?? null;
    let curNodeDepth = 1;
    for (const token of tokens) {
      if (curNodeDepth >= this.maxNodeDepth) break;
      if (curNodeDepth === tokenCount) break;
      const keyToChild = curNode.keyToChildNode;
      let next = keyToChild.get(token);
      if (!next) next = keyToChild.get(this.paramStr);
      if (!next) return null;
      curNode = next;
      curNodeDepth += 1;
    }
    return this.fastMatch(curNode.clusterIds, tokens, simTh, includeParams);
  }

  /** Insert a new cluster's template path into the tree. Faithful port of add_seq_to_prefix_tree. */
  addSeqToPrefixTree(cluster) {
    const tokenCount = cluster.logTemplateTokens.length;
    const tokenCountStr = String(tokenCount);
    let firstLayer = this.root.keyToChildNode.get(tokenCountStr);
    if (!firstLayer) {
      firstLayer = new Node();
      this.root.keyToChildNode.set(tokenCountStr, firstLayer);
    }
    let curNode = firstLayer;
    if (tokenCount === 0) {
      curNode.clusterIds = [cluster.clusterId];
      return;
    }
    let currentDepth = 1;
    for (const token of cluster.logTemplateTokens) {
      if (currentDepth >= this.maxNodeDepth || currentDepth >= tokenCount) {
        const fresh = curNode.clusterIds.filter((id) => this.idToCluster.has(id));
        fresh.push(cluster.clusterId);
        curNode.clusterIds = fresh;
        break;
      }
      const children = curNode.keyToChildNode;
      if (!children.has(token)) {
        if (this.parametrizeNumericTokens && this.hasNumbers(token)) {
          if (!children.has(this.paramStr)) {
            const n = new Node();
            children.set(this.paramStr, n);
            curNode = n;
          } else {
            curNode = children.get(this.paramStr);
          }
        } else if (children.has(this.paramStr)) {
          if (children.size < this.maxChildren) {
            const n = new Node();
            children.set(token, n);
            curNode = n;
          } else {
            curNode = children.get(this.paramStr);
          }
        } else if (children.size + 1 < this.maxChildren) {
          const n = new Node();
          children.set(token, n);
          curNode = n;
        } else if (children.size + 1 === this.maxChildren) {
          const n = new Node();
          children.set(this.paramStr, n);
          curNode = n;
        } else {
          curNode = children.get(this.paramStr);
        }
      } else {
        curNode = children.get(token);
      }
      currentDepth += 1;
    }
  }

  /**
   * Add a (already-masked) log line. Creates a cluster or merges into the closest one.
   * @param {string} content
   * @returns {{ cluster: LogCluster, changeType: 'cluster_created'|'cluster_template_changed'|'none' }}
   * @remarks The returned `cluster` is a LIVE reference — `cluster.size` and
   *   `cluster.logTemplateTokens` reflect the current state, not the state at call time.
   *   Copy out scalar values immediately if a snapshot is needed.
   */
  addLogMessage(content) {
    const tokens = tokenize(content, this.extraDelimiters);
    let cluster = this.treeSearch(tokens, this.simTh, false);
    if (cluster === null) {
      // Evict oldest cluster (FIFO) when at cap to prevent unbounded memory growth
      if (this.maxClusters > 0 && this.idToCluster.size >= this.maxClusters) {
        const oldestId = this.idToCluster.keys().next().value;
        this.idToCluster.delete(oldestId);
      }
      this.clustersCounter += 1;
      const id = this.clustersCounter;
      cluster = new LogCluster(tokens, id);
      this.idToCluster.set(id, cluster);
      this.addSeqToPrefixTree(cluster);
      return { cluster, changeType: 'cluster_created' };
    }
    const newTemplate = createTemplate(tokens, cluster.logTemplateTokens, this.paramStr);
    let changeType;
    if (arraysEqual(newTemplate, cluster.logTemplateTokens)) {
      changeType = 'none';
    } else {
      cluster.logTemplateTokens = newTemplate;
      changeType = 'cluster_template_changed';
    }
    cluster.size += 1;
    return { cluster, changeType };
  }

  /**
   * Inference-only exact match (no mutation). Requires a perfect token match
   * (sim 1.0, params counted). Matches Drain3 match() default semantics.
   * @param {string} content
   * @returns {LogCluster|null}
   */
  match(content) {
    const tokens = tokenize(content, this.extraDelimiters);
    return this.treeSearch(tokens, 1.0, true);
  }
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class TemplateMiner {
  /**
   * @param {{ masker?: LogMasker, drain?: Drain, drainOptions?: object, maskerOptions?: object }} [opts]
   */
  constructor(opts = {}) {
    this.masker = opts.masker ?? new LogMasker(opts.maskerOptions);
    this.drain = opts.drain ?? new Drain(opts.drainOptions);
  }

  /**
   * Mask + cluster a single raw log line.
   * @param {string} line
   * @returns {{ changeType: string, clusterId: number, clusterSize: number, templateMined: string }}
   */
  addLogMessage(line) {
    const masked = this.masker.mask(line);
    const { cluster, changeType } = this.drain.addLogMessage(masked);
    return {
      changeType,
      clusterId: cluster.clusterId,
      clusterSize: cluster.size,
      templateMined: cluster.getTemplate(),
    };
  }

  /**
   * Inference-only: which existing cluster does this line match (no mutation)?
   * @param {string} line
   * @returns {{ clusterId: number, template: string, size: number } | null}
   */
  match(line) {
    const cluster = this.drain.match(this.masker.mask(line));
    if (!cluster) return null;
    return { clusterId: cluster.clusterId, template: cluster.getTemplate(), size: cluster.size };
  }
}

// Error/severity keywords that mark a template as worth surfacing regardless of
// frequency. Matched case-insensitively against the (masked) template text.
const ANOMALY_KEYWORDS = /\b(error|errno|fatal|exception|panic|traceback|fail(ed|ure)?|timeout|timed out|refused|denied|unauthor|forbidden|crash|oom|killed|segfault|unhandled|reject(ed)?|stack ?trace)\b/i;

// 5xx HTTP status. Tested against the RAW line (before masking) — the NUM mask
// rule turns `502` into `<:NUM:>`, so a status code can never be recovered from
// the mined template. We tag the cluster at ingest time instead. Word-boundaried
// + exactly 3 digits so `5000` (a port) and `v1` (a version) don't match.
const STATUS_5XX = /\b5\d{2}\b/;

/**
 * Score a template's anomaly likelihood. Higher = more worth the agent's attention.
 * Combines error-keyword presence (strong signal), rarity (rare events are often
 * the anomaly), and a mild down-weight for very high-frequency benign chatter.
 *
 * NOTE: this is in-digest scoring (no baseline window). True baseline-delta ranking
 * (incident-window histogram vs a healthy window) is a v2 upgrade needing a second
 * log fetch; this is the cheap, no-extra-fetch version.
 * @param {{ template: string, count: number }} t
 * @param {number} totalLines
 * @returns {number}
 */
function anomalyScore(t, totalLines, hasStatus = false) {
  const isError = ANOMALY_KEYWORDS.test(t.template) || hasStatus;
  let score = 0;
  if (isError) score += 10;                              // error-bearing: dominant signal
  if (t.count === 1) score += 4;                         // singleton / novel
  else if (t.count <= 3) score += 2;                     // rare
  // Down-weight very frequent BENIGN chatter only. A frequent ERROR is the most
  // important signal, not the least — never penalize it for being common.
  const freq = totalLines > 0 ? t.count / totalLines : 0;
  if (!isError && freq > 0.25) score -= 2;
  return score;
}

/**
 * Mine a batch of raw log lines into a compact digest for the investigation agent.
 * @param {string[]} lines
 * @param {{ rareMaxCount?: number, anomalyTopN?: number, drainOptions?: object, maskerOptions?: object }} [opts]
 * @returns {{
 *   templates: Array<{ template: string, count: number, clusterId: number }>,
 *   rare: Array<{ template: string, count: number, clusterId: number }>,
 *   anomalies: Array<{ template: string, count: number, clusterId: number, anomalyScore: number }>,
 *   totalLines: number,
 *   clusterCount: number,
 * }}
 */
export function mineLogs(lines, opts = {}) {
  const rareMaxCount = opts.rareMaxCount ?? 1;
  const anomalyTopN = opts.anomalyTopN ?? 20;
  const tm = new TemplateMiner({ drainOptions: opts.drainOptions, maskerOptions: opts.maskerOptions });
  let totalLines = 0;
  // Cluster ids whose RAW (pre-mask) text carried a 5xx status — masking would
  // otherwise destroy the code, so tag the cluster here for anomaly scoring.
  const statusClusters = new Set();
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const r = tm.addLogMessage(line);
    if (STATUS_5XX.test(line)) statusClusters.add(r.clusterId);
    totalLines += 1;
  }
  const templates = tm.drain
    .clusters()
    .map((c) => ({ template: c.getTemplate(), count: c.size, clusterId: c.clusterId }))
    .sort((a, b) => b.count - a.count);
  const rare = templates.filter((t) => t.count <= rareMaxCount);
  // Anomaly ranking: surface templates most worth investigating (error-bearing +
  // rare), not just the rarest. Rarity != anomaly — a benign one-off shouldn't
  // outrank a 47x "POST /checkout 500".
  const anomalies = templates
    .map((t) => ({ ...t, anomalyScore: anomalyScore(t, totalLines, statusClusters.has(t.clusterId)) }))
    .filter((t) => t.anomalyScore > 0)
    .sort((a, b) => (b.anomalyScore - a.anomalyScore) || (b.count - a.count))
    .slice(0, anomalyTopN);
  return { templates, rare, anomalies, totalLines, clusterCount: templates.length };
}
