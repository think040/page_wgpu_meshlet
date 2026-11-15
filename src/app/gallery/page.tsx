import type { Metadata } from 'next';
import { GalleryShell } from '@/gallery/GalleryShell';

export const metadata: Metadata = { title: '3D 감상실' };

export default function GalleryPage() {
  return <GalleryShell />;
}
