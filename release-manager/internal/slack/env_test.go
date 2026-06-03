package slack

import "testing"

func TestCredentialsFromEnv(t *testing.T) {
	t.Run("both set", func(t *testing.T) {
		t.Setenv("SLACK_BOT_TOKEN", "xoxb-123")
		t.Setenv("SLACK_CHANNEL_ID", "C999")
		creds, ok := CredentialsFromEnv()
		if !ok {
			t.Fatal("ok = false, want true when both vars set")
		}
		if creds.Token != "xoxb-123" || creds.ChannelID != "C999" {
			t.Errorf("creds = %+v, want {xoxb-123 C999}", creds)
		}
	})

	t.Run("missing channel", func(t *testing.T) {
		t.Setenv("SLACK_BOT_TOKEN", "xoxb-123")
		t.Setenv("SLACK_CHANNEL_ID", "")
		if _, ok := CredentialsFromEnv(); ok {
			t.Error("ok = true, want false when channel unset")
		}
	})

	t.Run("missing token", func(t *testing.T) {
		t.Setenv("SLACK_BOT_TOKEN", "")
		t.Setenv("SLACK_CHANNEL_ID", "C999")
		if _, ok := CredentialsFromEnv(); ok {
			t.Error("ok = true, want false when token unset")
		}
	})
}

func TestSeedTSAndTS(t *testing.T) {
	n := New("tok", "C1")
	if got := n.TS(); got != "" {
		t.Errorf("fresh Notifier TS() = %q, want empty", got)
	}
	n.SeedTS("1716.0001")
	if got := n.TS(); got != "1716.0001" {
		t.Errorf("after SeedTS, TS() = %q, want 1716.0001", got)
	}

	// nil-safe (Slack disabled).
	var nilN *Notifier
	nilN.SeedTS("x") // must not panic
	if got := nilN.TS(); got != "" {
		t.Errorf("nil Notifier TS() = %q, want empty", got)
	}
}
