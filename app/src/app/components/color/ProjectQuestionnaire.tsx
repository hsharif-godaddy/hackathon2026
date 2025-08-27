'use client';

import { useState } from 'react';
import { ProjectQuestionnaireProps, ProjectAnswers } from './types';
import { ArrowRightIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';

const projectTypes = [
  { id: 'website', label: 'Website', description: 'Corporate or personal website' },
  { id: 'webapp', label: 'Web Application', description: 'Interactive web application' },
  { id: 'mobile', label: 'Mobile App', description: 'iOS or Android application' },
  { id: 'dashboard', label: 'Dashboard', description: 'Analytics or admin dashboard' },
  { id: 'ecommerce', label: 'E-commerce', description: 'Online store or marketplace' },
  { id: 'portfolio', label: 'Portfolio', description: 'Creative or professional portfolio' },
  { id: 'blog', label: 'Blog', description: 'Content publishing platform' },
  { id: 'other', label: 'Other', description: 'Something else entirely' },
];

// Removed targetAudiences and industries - streamlining the process

const brandPersonalities = [
  { id: 'professional', label: 'Professional', description: 'Serious, trustworthy, reliable' },
  { id: 'friendly', label: 'Friendly', description: 'Warm, approachable, welcoming' },
  { id: 'innovative', label: 'Innovative', description: 'Cutting-edge, modern, forward-thinking' },
  { id: 'playful', label: 'Playful', description: 'Fun, energetic, casual' },
  { id: 'luxurious', label: 'Luxurious', description: 'Premium, elegant, sophisticated' },
  { id: 'minimalist', label: 'Minimalist', description: 'Clean, simple, uncluttered' },
  { id: 'bold', label: 'Bold', description: 'Strong, confident, attention-grabbing' },
  { id: 'trustworthy', label: 'Trustworthy', description: 'Reliable, secure, dependable' },
];

export default function ProjectQuestionnaire({ 
  onComplete, 
  onNext, 
  onBack 
}: ProjectQuestionnaireProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Partial<ProjectAnswers>>({
    brandPersonality: [],
    existingBrandColors: [],
  });

  const questions = [
    {
      id: 'projectType',
      title: 'What type of project are you building?',
      subtitle: 'This helps us understand the design context.',
      type: 'single-choice' as const,
      options: projectTypes,
    },
    {
      id: 'brandPersonality',
      title: 'How would you describe your brand personality?',
      subtitle: 'Select all that apply. These traits will influence your color palette.',
      type: 'multi-choice' as const,
      options: brandPersonalities,
    },
    {
      id: 'colorTemperature',
      title: 'Do you prefer warm or cool colors?',
      subtitle: 'Warm colors are energetic and inviting, cool colors are calming and professional.',
      type: 'single-choice' as const,
      options: [
        { id: 'warm', label: 'Warm Colors', description: 'Reds, oranges, yellows - energetic and inviting' },
        { id: 'cool', label: 'Cool Colors', description: 'Blues, greens, purples - calming and professional' },
        { id: 'neutral', label: 'Neutral', description: 'Grays, browns, beiges - versatile and timeless' },
      ],
    },
  ];

  const currentQ = questions[currentQuestion];
  
  const handleAnswer = (value: any) => {
    if (currentQ.type === 'multi-choice') {
      const currentValues = (answers[currentQ.id as keyof ProjectAnswers] as string[]) || [];
      const newValues = currentValues.includes(value)
        ? currentValues.filter(v => v !== value)
        : [...currentValues, value];
      
      setAnswers(prev => ({
        ...prev,
        [currentQ.id]: newValues,
      }));
    } else {
      setAnswers(prev => ({
        ...prev,
        [currentQ.id]: value,
      }));
    }
  };

  const isAnswered = () => {
    const answer = answers[currentQ.id as keyof ProjectAnswers];
    if (currentQ.type === 'multi-choice') {
      return Array.isArray(answer) && answer.length > 0;
    }
    return answer !== undefined && answer !== '';
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      // Complete questionnaire
      onComplete(answers as ProjectAnswers);
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    } else if (onBack) {
      onBack();
    }
  };

  const renderQuestion = () => {
    const currentAnswer = answers[currentQ.id as keyof ProjectAnswers];

    switch (currentQ.type) {
      case 'single-choice':
        const shouldUseColumns = currentQ.options.length > 4;
        return (
          <div className={`grid gap-2 ${shouldUseColumns ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {currentQ.options.map((option: any) => (
              <button
                key={option.id}
                onClick={() => handleAnswer(option.id)}
                className={`
                  p-3 border-2 rounded-lg text-left transition-all hover:border-blue-300
                  ${currentAnswer === option.id 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:bg-gray-50'
                  }
                `}
              >
                <div className="font-medium text-gray-900 text-sm">{option.label}</div>
                {option.description && (
                  <div className="text-xs text-gray-600 mt-1">{option.description}</div>
                )}
              </button>
            ))}
          </div>
        );

      case 'multi-choice':
        const shouldUseColumnsMulti = currentQ.options.length > 4;
        return (
          <div className={`grid gap-2 ${shouldUseColumnsMulti ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {currentQ.options.map((option: any) => {
              const isSelected = Array.isArray(currentAnswer) && currentAnswer.includes(option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => handleAnswer(option.id)}
                  className={`
                    p-3 border-2 rounded-lg text-left transition-all hover:border-blue-300
                    ${isSelected 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:bg-gray-50'
                    }
                  `}
                >
                  <div className="font-medium text-gray-900 text-sm">{option.label}</div>
                  {option.description && (
                    <div className="text-xs text-gray-600 mt-1">{option.description}</div>
                  )}
                </button>
              );
            })}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Question {currentQuestion + 1} of {questions.length}</span>
          <span>{Math.round(((currentQuestion + 1) / questions.length) * 100)}% Complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{currentQ.title}</h2>
        <p className="text-gray-600 mb-6">{currentQ.subtitle}</p>
        
        {renderQuestion()}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={handlePrevious}
          className="flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span>Previous</span>
        </button>

        <button
          onClick={handleNext}
          disabled={!isAnswered()}
          className={`
            flex items-center space-x-2 px-6 py-2 rounded-lg font-medium transition-colors
            ${isAnswered()
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          <span>{currentQuestion === questions.length - 1 ? 'Complete' : 'Next'}</span>
          <ArrowRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
