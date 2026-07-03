import { useState } from 'react';

const FAQ_ITEMS = [
  {
    question: 'How do I book an appointment?',
    answer:
      'You can book online via the "Book Appointment" button on our home page, ' +
      'or call us at (555) 867-5309 during office hours. We typically have ' +
      'availability within 1–2 weeks for routine visits.',
  },
  {
    question: 'Do you accept dental insurance?',
    answer:
      'Yes. We accept most major dental insurance plans including Delta Dental, ' +
      'Cigna, Aetna, and BlueCross BlueShield. Please contact our office to ' +
      'verify your specific coverage before your appointment.',
  },
  {
    question: 'How often should I get a cleaning?',
    answer:
      'For most patients we recommend a professional cleaning every six months. ' +
      'Patients with gum disease or a history of heavy tartar build-up may ' +
      'benefit from more frequent visits — your dentist will advise you.',
  },
  {
    question: 'What should I expect on my first visit?',
    answer:
      'Your first visit includes a full oral exam, digital X-rays, and a ' +
      'professional cleaning. The dentist will review your dental history and ' +
      'discuss any concerns. Plan for about 60–90 minutes.',
  },
  {
    question: 'What should I do in a dental emergency?',
    answer:
      'Call our office immediately at (555) 867-5309. We reserve same-day slots ' +
      'for emergencies during business hours. For after-hours emergencies, ' +
      'our voicemail will direct you to the on-call dentist.',
  },
];

interface AccordionItemProps {
  question: string;
  answer: string;
}

function AccordionItem({ question, answer }: AccordionItemProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-gray-200">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left py-4 px-2 flex justify-between items-center font-medium text-gray-800 hover:text-blue-700 transition-colors"
        aria-expanded={open}
      >
        {question}
        <span className="ml-4 text-blue-600">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-2 pb-4 text-gray-600 text-sm">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function FaqPage() {
  return (
    <main className="max-w-3xl mx-auto py-16 px-4">
      <h1 className="text-3xl font-bold text-blue-800 mb-4">Frequently Asked Questions</h1>
      <p className="text-gray-600 mb-10">
        Can't find your answer here? Call us at (555) 867-5309.
      </p>

      <div className="border-t border-gray-200">
        {FAQ_ITEMS.map((item) => (
          <AccordionItem key={item.question} question={item.question} answer={item.answer} />
        ))}
      </div>
    </main>
  );
}
