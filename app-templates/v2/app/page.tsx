import Image from "next/image";

export default function Home() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="relative">
        {/* Outer rotating ring */}
        <div className="absolute inset-0 w-32 h-32 border-4 border-blue-200 rounded-full animate-rotate-clockwise"></div>
        
        {/* Middle ring with different rotation */}
        <div className="absolute inset-2 w-28 h-28 border-4 border-purple-300 rounded-full animate-rotate-counter"></div>
        
        {/* Inner pulsing circle */}
        <div className="absolute inset-6 w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full animate-pulse-slow"></div>
        
        {/* Central floating element */}
        <div className="absolute inset-10 w-12 h-12 bg-white rounded-full shadow-lg animate-float flex items-center justify-center">
          <div className="w-6 h-6 bg-gradient-to-br from-blue-600 to-purple-700 rounded-full"></div>
        </div>
        
        {/* Orbiting dots */}
        <div className="absolute inset-0 w-32 h-32 animate-rotate-clockwise">
          <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-blue-500 rounded-full"></div>
          <div className="absolute top-1/2 -right-1 transform -translate-y-1/2 w-3 h-3 bg-purple-500 rounded-full"></div>
          <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-indigo-500 rounded-full"></div>
          <div className="absolute top-1/2 -left-1 transform -translate-y-1/2 w-3 h-3 bg-violet-500 rounded-full"></div>
        </div>
        
        {/* Geometric shapes around */}
        <div className="absolute -top-8 -left-8 w-4 h-4 bg-blue-400 transform rotate-45 animate-bounce-gentle"></div>
        <div className="absolute -top-8 -right-8 w-0 h-0 border-l-4 border-r-4 border-b-6 border-l-transparent border-r-transparent border-b-purple-400 animate-float"></div>
        <div className="absolute -bottom-8 -left-8 w-4 h-4 bg-indigo-400 rounded-full animate-pulse-slow"></div>
        <div className="absolute -bottom-8 -right-8 w-4 h-4 bg-violet-400 animate-spin-slow"></div>
      </div>
    </div>
  );
}
