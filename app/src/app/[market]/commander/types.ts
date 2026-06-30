export enum BuilderLayout {
  Develop = 'develop',
  Commander = 'commander',
  /**
   * Design-kit immersive takeover (AIROBUILD-3095): the guided gathering → brand →
   * website experience. Used while the design-kit flow is in progress; on reveal the
   * builder switches to Develop or Commander (per the appbuilder-commander flag).
   */
  Immersive = 'immersive',
}

export enum CommanderPosition {
  LeftDock = 'left-dock',
  Floating = 'floating',
}

export enum FloatingAnchor {
  BottomLeft = 'bottom-left',
  BottomCenter = 'bottom-center',
  BottomRight = 'bottom-right',
}

export enum SnapTarget {
  LeftDock = 'left-dock',
  BottomLeft = 'bottom-left',
  BottomCenter = 'bottom-center',
  BottomRight = 'bottom-right',
}
