export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  scheme: 'light' | 'dark' | 'auto';
  name?: string;
}

export interface ColorOption {
  name: string;
  color: string;
  description?: string;
}

export interface ColorCategory {
  name: string;
  colors: ColorOption[];
}

export interface ColorPaletteOption {
  id: string;
  name: string;
  description: string;
  palette: ColorPalette;
  previewImage?: string;
}

export interface ColorPaletteGridProps {
  categories?: ColorCategory[];
  selectedColor: string | null;
  onColorSelect: (color: string, colorName: string) => void;
  title?: string;
  subtitle?: string;
}

export interface ColorSchemePreviewProps {
  palette: ColorPalette;
}

export interface ColorPaletteSelectorProps {
  onPaletteSelect: (palette: ColorPalette) => void;
  onNext?: () => void;
  onBack?: () => void;
  currentStep?: number;
  totalSteps?: number;
}

export interface ProjectQuestionnaireProps {
  onComplete: (answers: ProjectAnswers) => void;
  onNext?: () => void;
  onBack?: () => void;
}

export interface ProjectAnswers {
  projectType: string;
  brandPersonality: string[];
  colorTemperature: 'warm' | 'cool' | 'neutral';
  existingBrandColors?: string[];
}

export interface ColorDesignFlowProps {
  appId: string;
  onComplete: (palette: ColorPalette) => void;
  onCancel?: () => void;
}
