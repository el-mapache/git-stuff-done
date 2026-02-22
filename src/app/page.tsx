import { Suspense } from 'react';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Dashboard />
    </Suspense>
  );
}
