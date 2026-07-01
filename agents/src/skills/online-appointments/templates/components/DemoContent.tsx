import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Zap, Lock, Palette } from "lucide-react";

export default function DemoContent() {
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary to-secondary px-4 py-8">
        <div className="relative z-10 mx-auto max-w-4xl text-center">
          <p className="mb-4 text-lg text-primary-foreground/90 md:text-xl">
            Demo Content, will be replaced with your app
          </p>
          <Button variant="secondary" size="lg">
            Get Started
          </Button>
        </div>
        <div className="absolute left-10 top-10 h-32 w-32 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="absolute bottom-10 right-10 h-40 w-40 rounded-full bg-primary-foreground/10 blur-3xl" />
      </section>

      {/* Features Section */}
      <section className="bg-muted px-4 py-6">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-6 text-center text-xl font-bold text-foreground md:text-2xl">
            Key Features
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="transition-shadow hover:shadow-lg">
              <CardContent className="p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                  <Zap className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">Fast Performance</h3>
                <p className="text-sm text-muted-foreground">
                  Lightning-fast load times and smooth interactions.
                </p>
              </CardContent>
            </Card>

            <Card className="transition-shadow hover:shadow-lg">
              <CardContent className="p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                  <Lock className="h-5 w-5 text-secondary-foreground" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">Secure & Reliable</h3>
                <p className="text-sm text-muted-foreground">
                  Built with security best practices to keep data safe.
                </p>
              </CardContent>
            </Card>

            <Card className="transition-shadow hover:shadow-lg">
              <CardContent className="p-4">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                  <Palette className="h-5 w-5 text-accent-foreground" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">Customizable</h3>
                <p className="text-sm text-muted-foreground">
                  Easily customize colors and components to match your brand.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Contact Form Section */}
      <section className="bg-background px-4 py-6">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-2 text-center text-xl font-bold text-foreground md:text-2xl">
            Get in Touch
          </h2>
          <p className="mb-4 text-center text-sm text-muted-foreground">
            Have questions? We'd love to hear from you.
          </p>
          <form className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label htmlFor="demo-name" className="mb-1 text-xs">
                  Name
                </Label>
                <Input id="demo-name" placeholder="Your name" />
              </div>
              <div>
                <Label htmlFor="demo-email" className="mb-1 text-xs">
                  Email
                </Label>
                <Input id="demo-email" type="email" placeholder="your@email.com" />
              </div>
            </div>
            <div>
              <Label htmlFor="demo-message" className="mb-1 text-xs">
                Message
              </Label>
              <Textarea
                id="demo-message"
                rows={3}
                placeholder="Your message..."
                className="resize-none"
              />
            </div>
            <Button type="submit" className="w-full">
              Send Message
            </Button>
          </form>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-accent px-4 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-4 text-3xl font-bold text-accent-foreground md:text-4xl">
            Ready to Get Started?
          </h2>
          <p className="mb-8 text-xl text-accent-foreground/90">
            Join thousands of satisfied users today
          </p>
          <Button variant="secondary" size="lg">
            Sign Up Now
          </Button>
        </div>
      </section>
    </div>
  );
}
