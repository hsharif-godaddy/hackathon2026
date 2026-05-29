src/pages/contact.tsx [122-131 of 228] (truncated — use startLine/numLines to read remaining)
   122|              {/* What to expect */}
   123|              <div className="bg-muted rounded-2xl p-6 space-y-3">
   124|                <h3 className="font-bold text-gray-900">What happens next?</h3>
   125|                {[
   126|                  'We'll review your request and reach out within a few hours',
   127|                  'We'll confirm your service, date, and pricing',
   128|                  'Our team arrives on time, ready to make your home shine',
   129|                ].map((step, i) => (
   130|                  <div key={i} className="flex items-start gap-3">
   131|                    <CheckCircle size={16} className="text-primary shrink-0 mt-0.5" />