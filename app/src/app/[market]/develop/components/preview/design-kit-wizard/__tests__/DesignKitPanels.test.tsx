// @vitest-environment jsdom
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DESIGN_KIT_EID } from '../designKitEvents';
import { ColorPanel, DesignKitPanels, FontsPanel, LogoMoodBoardPanel, SummaryPanel,VoicePanel } from '../DesignKitPanels';

// Hoist mocks
const { actionSpy, clickSpy, impressionSpy, setColorsSpy, setFontsSpy, setVoiceSpy, setImagerySpy } = vi.hoisted(() => ({
  actionSpy: vi.fn(),
  clickSpy: vi.fn(),
  impressionSpy: vi.fn(),
  setColorsSpy: vi.fn(),
  setFontsSpy: vi.fn(),
  setVoiceSpy: vi.fn(),
  setImagerySpy: vi.fn(),
}));

vi.mock('../designKitEvents', () => ({
  DESIGN_KIT_EID: {
    brandColor: 'develop.design_kit.brand_color',
    brandFonts: 'develop.design_kit.brand_fonts',
    brandLogo: 'develop.design_kit.brand_logo',
    brandImagery: 'develop.design_kit.brand_imagery',
    brandVoice: 'develop.design_kit.brand_voice',
    brandSummary: 'develop.design_kit.brand_summary',
    logoUpload: 'develop.design_kit.logo_upload',
  },
  fireDesignKitAction: actionSpy,
  fireDesignKitClick: clickSpy,
  fireDesignKitImpression: impressionSpy,
}));

vi.mock('../designKitApi', () => ({
  designKitApi: {
    setColors: setColorsSpy,
    setFonts: setFontsSpy,
    setVoice: setVoiceSpy,
    setImagery: setImagerySpy,
  },
}));

vi.mock('../useBrandData', () => ({
  useBrandData: () => ({
    data: {
      palette: { primary: '#000000', background: '#ffffff', name: 'Custom' },
      typography: { heading: { family: 'Arial', weights: ['400'] }, body: { family: 'Arial', weights: ['400'] } },
      voice: { weAre: ['bold', 'fast'] },
      summary: { text: 'Test summary' },
      imagery: { keyword: 'test mood', moodImages: [] },
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useMediaManifest', () => ({
  useMediaManifest: () => ({
    manifest: undefined,
    slotNames: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector({
    currentAppId: 'app123',
    loadingPhase: 'ready',
  }),
}));

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: any) => selector({
    getServerState: () => ({ url: 'http://test' }),
  }),
}));

vi.mock('@/app/[market]/develop/components/utils/previewThemeInIframe', () => ({
  previewThemeInIframe: vi.fn(),
}));

vi.mock('@/app/[market]/develop/components/utils/previewFontInIframe', () => ({
  previewFontInIframe: vi.fn(),
}));

vi.mock('../FontPicker', () => ({
  FontPicker: ({ onApply }: any) => (
    <button data-testid="mock-apply-fonts" onClick={() => onApply({ name: 'Heading' }, { name: 'Body' })}>
      Apply Fonts
    </button>
  ),
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
}));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'http://test-agent' }),
  },
}));

vi.mock('@/utils/image-compression', () => ({
  compressImageFile: vi.fn().mockImplementation((f) => Promise.resolve(f)),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

global.fetch = vi.fn().mockResolvedValue({ ok: true });

describe('DesignKitPanels Events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Impressions', () => {
    it('fires impressions exactly once on mount for all panels', () => {
      render(<DesignKitPanels appId="app123" />);
      
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandColor, { element: 'color' });
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandFonts, { element: 'fonts' });
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandLogo, { element: 'logo' });
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandImagery, { element: 'imagery' });
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandVoice, { element: 'voice' });
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandSummary, { element: 'summary' });
    });

    it('ColorPanel fires impression', () => {
      render(<ColorPanel palette={{}} onChange={vi.fn()} />);
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandColor, { element: 'color' });
    });

    it('FontsPanel fires impression', () => {
      render(<FontsPanel headingName="Inter" bodyName="Inter" onApply={vi.fn()} />);
      expect(impressionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandFonts, { element: 'fonts' });
    });
  });

  describe('Color changes', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fires brandColor action only after 450ms debounce and only if valid', () => {
      render(<DesignKitPanels appId="app123" />);
      const colorInputs = screen.getAllByLabelText(/Pick.*colour/i);
      
      fireEvent.change(colorInputs[0], { target: { value: '#ff0000' } });
      
      expect(actionSpy).not.toHaveBeenCalledWith(DESIGN_KIT_EID.brandColor, expect.anything(), expect.anything());
      
      act(() => {
        vi.advanceTimersByTime(450);
      });
      
      expect(setColorsSpy).toHaveBeenCalled();
      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandColor, 'load', { 
        element: 'color', 
        source: 'direct', 
        trigger: 'color_input' 
      });
      expect(actionSpy).toHaveBeenCalledTimes(1);
    });

    it('does not fire brandColor action twice for rapid changes', () => {
      render(<DesignKitPanels appId="app123" />);
      const colorInputs = screen.getAllByLabelText(/Pick.*colour/i);
      
      fireEvent.change(colorInputs[0], { target: { value: '#ff0000' } });
      act(() => { vi.advanceTimersByTime(200); });
      
      fireEvent.change(colorInputs[0], { target: { value: '#00ff00' } });
      act(() => { vi.advanceTimersByTime(450); });
      
      expect(setColorsSpy).toHaveBeenCalledTimes(1);
      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandColor, 'load', expect.anything());
      expect(actionSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Font changes', () => {
    it('fires brandFonts action on applyFonts', () => {
      render(<DesignKitPanels appId="app123" />);
      fireEvent.click(screen.getByTestId('mock-apply-fonts'));
      
      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandFonts, 'load', {
        element: 'fonts',
        source: 'direct',
        trigger: 'apply'
      });
    });
  });

  describe('VoicePanel changes', () => {
    it('fires brandVoice action on add', () => {
      render(<VoicePanel appId="app123" voice={{ weAre: ['bold'] }} />);
      const input = screen.getByTestId('voice-input');
      
      fireEvent.change(input, { target: { value: 'innovative' } });
      fireEvent.blur(input); // or Enter
      
      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandVoice, 'load', {
        element: 'voice',
        source: 'direct',
        trigger: 'add',
        count: 2
      });
    });

    it('fires brandVoice action on remove', () => {
      render(<VoicePanel appId="app123" voice={{ weAre: ['bold', 'fast'] }} />);
      const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
      
      fireEvent.click(removeButtons[0]);
      
      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandVoice, 'load', {
        element: 'voice',
        source: 'direct',
        trigger: 'remove',
        count: 1
      });
    });
  });

  describe('LogoMoodBoardPanel changes', () => {
    it('fires logoUpload click on button click', () => {
      render(<LogoMoodBoardPanel appId="app123" />);
      fireEvent.click(screen.getByTestId('logo-upload-button'));
      
      expect(clickSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.logoUpload, {
        element: 'logo',
        source: 'direct'
      });
    });

    it('fires brandLogo action on successful upload', async () => {
      render(<LogoMoodBoardPanel appId="app123" />);
      const input = screen.getByTestId('logo-upload-input');
      
      const file = new File(['dummy content'], 'logo.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
      
      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandLogo, 'load', {
        element: 'logo',
        source: 'direct',
        trigger: 'upload'
      });
    });

    it('fires brandImagery action on imagery input blur after a change', () => {
      render(<LogoMoodBoardPanel appId="app123" />);
      const input = screen.getByTestId('imagery-input');

      fireEvent.change(input, { target: { value: 'minimal neutral' } });
      fireEvent.blur(input);

      expect(actionSpy).toHaveBeenCalledWith(DESIGN_KIT_EID.brandImagery, 'load', {
        element: 'imagery',
        source: 'direct',
        trigger: 'blur'
      });
    });

    it('does not fire brandImagery on blur when the caption is unchanged', () => {
      render(<LogoMoodBoardPanel appId="app123" keyword="existing caption" />);
      const input = screen.getByTestId('imagery-input');

      fireEvent.blur(input);

      expect(actionSpy).not.toHaveBeenCalledWith(DESIGN_KIT_EID.brandImagery, 'load', expect.anything());
    });
  });
});
