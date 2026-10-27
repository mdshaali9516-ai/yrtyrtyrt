import React from 'react';
import { useApp } from '../context/AppContext.js';
import { ProductDetailsPage } from './ProductDetailsPage.js';

export const ProductDetailsModal: React.FC = () => {
  const { selectedProduct, setSelectedProduct } = useApp();

  if (!selectedProduct) return null;

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4">
      <div 
        className="relative bg-white w-full max-w-5xl rounded-none sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[96vh] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto flex-1">
          <ProductDetailsPage
            product={selectedProduct}
            onBack={() => setSelectedProduct(null)}
            onSelectRelated={(prod) => setSelectedProduct(prod)}
          />
        </div>
      </div>
    </div>
  );
};
