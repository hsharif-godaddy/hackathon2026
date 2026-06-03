import figma from '@figma/code-connect';
import { BuilderHeader } from './BuilderHeader';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=129-77
figma.connect(
  BuilderHeader,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=129-77',
  {
    props: {
      airoLabel: figma.string('airoLabel'),
      betaLabel: figma.string('betaLabel'),
      publishLabel: figma.string('publishLabel'),
      shareLabel: figma.string('shareLabel'),
      refreshLabel: figma.string('refreshLabel'),
      desktopLabel: figma.string('desktopLabel'),
      mobileLabel: figma.string('mobileLabel'),
      userLabel: figma.string('userLabel'),
    },
    example: ({
      airoLabel,
      betaLabel,
      publishLabel,
      shareLabel,
      refreshLabel,
      desktopLabel,
      mobileLabel,
      userLabel,
    }) => (
      <BuilderHeader
        airoLabel={airoLabel}
        betaLabel={betaLabel}
        publishLabel={publishLabel}
        shareLabel={shareLabel}
        refreshLabel={refreshLabel}
        desktopLabel={desktopLabel}
        mobileLabel={mobileLabel}
        userLabel={userLabel}
        onPublish={() => {}}
        onShare={() => {}}
        onRefresh={() => {}}
        onDeviceChange={() => {}}
      />
    ),
  },
);
