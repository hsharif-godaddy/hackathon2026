/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool */
import DesignPreview from '../components/design-preview';
import { brandData } from '../components/design-preview/brand-data';
import Showcase from '../components/design-preview/Showcase';

export default function DesignPreviewPage() {
  return <DesignPreview {...brandData} showcase={<Showcase />} />;
}
