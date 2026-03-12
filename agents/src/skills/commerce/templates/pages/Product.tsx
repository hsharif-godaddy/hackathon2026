'use client';
import { ProductDetails } from '@godaddy/react';
import { useParams } from 'react-router-dom';

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  return <ProductDetails productId={id!} onAddToCartSuccess={() => {}} />;
}
