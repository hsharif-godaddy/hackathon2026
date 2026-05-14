#!/usr/bin/env python3
"""
LR Classifier Training Script for Assessment Agent

Trains a Logistic Regression classifier on OpenAI text-embedding-3-small embeddings
to classify user prompts as 'fix' or 'general'. Exports a JSON artifact that can be
loaded by lr-classifier.ts for inference.

Usage:
  python train-lr-classifier.py [--no-cache] [--output PATH]

  OPENAI_API_KEY   required
  OPENAI_BASE_URL  optional override (default: GoCode OpenAI-compatible proxy)

Outputs default to ./weights/lr-embedding-weights-<UTCstamp>.json and
./weights/lr-training-report-<UTCstamp>.json

Training YAMLs are read from <script_dir>/training/ in the order listed in
TRAINING_CORPUS_FILES (see load_all_data()).

Requirements:
  pip install scikit-learn pyyaml numpy openai
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
OFFLINE_ML_ROOT = SCRIPT_DIR.parent
if str(OFFLINE_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(OFFLINE_ML_ROOT))

import numpy as np
import yaml
from openai import OpenAI
from pyutil.openai_embeddings import fetch_embeddings, load_cache
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.preprocessing import LabelEncoder

TRAINING_DATA_DIR = SCRIPT_DIR / "training"
TRAINING_CORPUS_FILES = [
    "traces-corpus.yaml",
    "hard-corpus.yaml",
    "q42b49ydf4_traces-corpus.yaml",
    "m662c6wfhd_traces-corpus2.yaml",
    "mixed-corpus-binary.yaml",
]

GOCODE_BASE_URL = "https://caas-gocode-prod.caas-prod.prod.onkatana.net/v1"
EMBEDDING_DIM = 1536
VALID_LABELS = {"fix", "general"}
MAX_PROMPT_LENGTH = 2000
OVERFITTING_THRESHOLD = 0.10
CV_FOLDS = 5
C_VALUES = [0.01, 0.1, 1.0, 10.0, 100.0]
PCA_DIMS = [256, 512]


CATEGORY_EXAMPLES_FIX = [
    'fix this',
    'fix it',
    'fix this bug',
    'fix the bug',
    'fix my site',
    'fix my app',
    'fix the issue',
    'fix the problem',
    'fix that',
    'fix please',
    'fix the button',
    'fix the page',
    'fix the form',
    'debug this',
    'help me fix',
    'troubleshoot this',
    'something is broken',
    'its broken',
    'it is broken',
    'this is broken',
    'the site is broken',
    'my site is broken',
    'my website is broken',
    'everything is broken',
    'the button is broken',
    'the menu is broken',
    'broken functionality',
    'broken link',
    'layout is broken',
    'not working',
    'its not working',
    'this is not working',
    'the button doesnt work',
    'button doesnt work',
    'navigation doesnt work',
    'checkout not working',
    'form doesnt submit',
    'the form is not submitting',
    'nothing works',
    'page not loading',
    'image wont load',
    'images not showing up',
    'images wont load',
    'customers cant checkout',
    'there is an error',
    'theres an error',
    'i got an error',
    'getting an error',
    'error message',
    'error message appears',
    'javascript error',
    'console error',
    'theres a bug',
    'i found a bug',
    'there is a problem',
    'something went wrong',
    'this is failing',
    'it crashed',
    'the site crashed',
    'it keeps crashing',
    'blank page',
    'having issues',
    'help something is wrong',
    'it was working before',
    'this was working and now its broken',
    'it broke after the last change',
    'you broke it',
    'since yesterday it stopped working',
    'suddenly stopped working',
    'stopped working',
    'it broke',
    'something broke',
    'something is broken after the update',
    'the form broke',
    'the button broke after your change',
    'fixx this',
    'fixx this bug',
    'fxi the bug',
    'fxi the error',
    'its brokn',
    'somethings borken',
    '修复这个错误',
    '出错了',
    '修復錯誤',
    'バグを直して',
    'エラーが出た',
    '버그 수정',
    '오류가 발생했습니다',
    'แก้ไขบัค',
    'इसे ठीक करो',
    'कुछ गड़बड़ है',
    'أصلح هذا',
    'هناك خطأ',
    'תתקן את זה',
    'יש באג',
    'Исправь это',
    'Произошла ошибка',
    'Виправ це',
    'Сталася помилка',
    'it still shows the old data',
    'the footer still reads the wrong email',
    'the heart is still not filled red',
    'the header is still cutting off',
    'still the same problem',
    'still the same fail to load',
    'I can still see the transparent background',
    'I can still see the old logo',
    'nothing changed, still broken',
    'same issue as before',
    'same thing happened again',
    'when I click on it nothing happens',
    'clicking the link does nothing',
    'I click the button and nothing happens',
    'tapping the menu does nothing',
    'the features links dont respond',
    'the footer links dont take me anywhere useful',
    'the view count is not supposed to be zero',
    'the price shows the wrong amount',
    'it shows the wrong date',
    'the counter is showing incorrect numbers',
    'the data is wrong',
    'it displays the wrong information',
    'it just keeps spinning',
    'the loading spinner never stops',
    'the sending just keeps spinning',
    'the form submits but keeps spinning',
    'stuck on loading',
    'loading forever',
    'the page never finishes loading',
    'the spinner keeps going',
    'there is a big gap on the right side',
    'the text is overlapping other elements',
    'the video is cut off at the top',
    'the header is cut off on mobile',
    'the image is not showing',
    'I can only see white',
    'the section does not open in preview',
    'the buttons overlap with other elements',
    'I get invalid email or password when I try to login',
    'it wont let me sign in',
    'invalid credentials when logging in',
    'the login page rejects my password',
    'it didnt work',
    'it didnt',
    'nope still the same',
    'that didnt help',
    'no change',
    'still nothing',
    'the links show 404',
    'that page gives me a 404',
    'the admin links still show 404',
    'clicking checkout takes me to a 404',
    'the page says not found',
    'I never got the confirmation email',
    'the quote was sent but I havent received it',
    'the notification never arrived',
    'I submitted the form but nothing was sent',
    'まだ同じ問題です',
    '아직도 같은 문제입니다',
    '还是一样的问题',
    'ยังเหมือนเดิม',
    'अभी भी वही समस्या है',
    'لا تزال نفس المشكلة',
    'עדיין אותה בעיה',
    'Всё ещё та же проблема',
    'Досі та сама проблема',
    'クリックしても何も起きない',
    '클릭해도 아무 반응이 없어요',
    '点击后没有反应',
    'กดแล้วไม่มีอะไรเกิดขึ้น',
    'क्लिक करने पर कुछ नहीं होता',
    'الضغط لا يفعل شيئاً',
    'לוחץ ושום דבר לא קורה',
    'Нажимаю, ничего не происходит',
    'Натискаю, нічого не відбувається',
    'ずっと読み込み中',
    '계속 로딩 중입니다',
    '一直在转圈',
    'โหลดไม่เสร็จสักที',
    'लोड होना बंद नहीं हो रहा',
    'التحميل لا يتوقف',
    'הטעינה לא נגמרת',
    'Загрузка не прекращается',
    'Завантаження не припиняється',
    '画像が表示されない',
    '이미지가 안 보여요',
    '图片不显示',
    'รูปภาพไม่แสดง',
    'तस्वीर दिखाई नहीं दे रही',
    'الصورة لا تظهر',
    'התמונה לא מוצגת',
    'Изображение не отображается',
    'Зображення не відображається',
    'だめだった',
    '안 됐어요',
    '没用',
    'ไม่ได้ผล',
    'काम नहीं किया',
    'لم ينجح',
    'לא עבד',
    'Не сработало',
    'Не спрацювало',
    'ページが見つかりません',
    '페이지를 찾을 수 없습니다',
    '页面找不到',
    'ไม่พบหน้าเว็บ',
    'पेज नहीं मिला',
    'الصفحة غير موجودة',
    'הדף לא נמצא',
    'Страница не найдена',
    'Сторінку не знайдено',
    'ログインできない',
    '로그인이 안 돼요',
    '登录不了',
    'เข้าสู่ระบบไม่ได้',
    'लॉगिन नहीं हो रहा',
    'لا أستطيع تسجيل الدخول',
    'לא מצליח להתחבר',
    'Не могу войти',
    'Не можу увійти',
    'メールが届かない',
    '이메일이 안 와요',
    '邮件没有收到',
    'ไม่ได้รับอีเมล',
    'ईमेल नहीं आया',
    'لم أتلقَّ البريد الإلكتروني',
    'לא קיבלתי את המייל',
    'Письмо не пришло',
    'Лист не надійшов',
]

CATEGORY_EXAMPLES_GENERAL = [
    'create a website for my bakery',
    'build me an online store',
    'make me a portfolio site',
    'I want a landing page for my business',
    'design a website for my restaurant',
    'build an app for my company',
    'create a blog',
    'make a simple website',
    'build me a site',
    'create a site for my business',
    'make me a website',
    'I need a website',
    'build a website',
    'create my website',
    'add a contact form',
    'change the colors',
    'add a new page',
    'update the header',
    'add more images',
    'change the font',
    'how do I publish my site',
    'what is my domain',
    'how does this work',
    'how do I fix this myself',
    'what does this error mean',
    'continue',
    'keep going',
    'continue building',
    'finish this',
    'finish the site',
    'complete this',
    'complete the page',
    'resume',
    'pick up where you left off',
    'continue from where you stopped',
    'keep working on this',
    'finish what you started',
    'you stopped, continue',
    'this isnt finished',
    'you didnt finish',
    'the page is incomplete',
    'you left this unfinished',
    'you stopped in the middle',
    'the page is empty',
    'content is missing',
    'the about page is missing',
    'some pages are missing',
    'the link doesnt go anywhere',
    'links arent set up yet',
    'write a blog post titled How to Fix Common CSS Bugs',
    'add a section called Common Errors and Solutions',
    'add a publish date to each blog post',
    'the hero section should say Go Live in 5 Minutes',
    'create a release notes page with version history',
    'change the button text to Report a Bug',
    'add a domain authority badge to the homepage',
    'change the email address in the footer',
    'update the phone number',
    'replace the logo with a new one',
    'change the contact info',
    'delete this section',
    'remove that image',
    '为我的面包店创建网站',
    '帮我建一个网站',
    '為我的餐廳設計網站',
    'ウェブサイトを作って',
    'ポートフォリオを作成',
    '웹사이트 만들어줘',
    '블로그 만들기',
    'สร้างเว็บไซต์',
    'मेरी बेकरी के लिए वेबसाइट बनाओ',
    'एक ब्लॉग बनाओ',
    'أنشئ موقعاً لمخبزي',
    'أريد موقع ويب',
    'תבנה לי אתר',
    'צור בלוג',
    'Создай сайт для моей пекарни',
    'Сделай мне сайт',
    'Створи сайт для моєї пекарні',
    'Зроби мені сайт',
    '继续',
    '继续工作',
    '完成这个',
    '続けて',
    '계속해',
    'ทำต่อ',
    'जारी रखो',
    'استمر',
    'תמשיך',
    'Продолжай',
    'Продовжуй',
]


def inline_category_example_pairs() -> list[tuple[str, str]]:
    """(prompt, label) pairs from embedded CATEGORY_EXAMPLES (fix / general)."""
    pairs: list[tuple[str, str]] = []
    for text in CATEGORY_EXAMPLES_FIX:
        pairs.append((text[:MAX_PROMPT_LENGTH], "fix"))
    for text in CATEGORY_EXAMPLES_GENERAL:
        pairs.append((text[:MAX_PROMPT_LENGTH], "general"))
    return pairs


# ============================================================================
# Data Loading
# ============================================================================


def load_yaml_corpus(path: Path) -> list[tuple[str, str]]:
    """Load (prompt, label) pairs from a corpus YAML file.

    Skips cases without 'expectedTaskType', maps non-binary labels:
    - 'publish' and 'domain' -> 'general' (not-fix intent)
    """
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    cases = data.get("cases", [])
    pairs = []
    for case in cases:
        prompt = case.get("prompt", "").strip()
        label = case.get("expectedTaskType", "").strip().lower()
        if not prompt or not label:
            continue
        if label not in VALID_LABELS:
            label = "general"
        pairs.append((prompt[:MAX_PROMPT_LENGTH], label))
    return pairs


def load_all_data() -> list[tuple[str, str]]:
    """Aggregate all training data from training/ (ordered list) and inline examples."""
    all_pairs: list[tuple[str, str]] = []
    sources_loaded = []

    if not TRAINING_DATA_DIR.is_dir():
        print(f"ERROR: training data directory not found: {TRAINING_DATA_DIR}", file=sys.stderr)
        sys.exit(1)
    corpus_files = [TRAINING_DATA_DIR / name for name in TRAINING_CORPUS_FILES]
    for path in corpus_files:
        if path.exists():
            pairs = load_yaml_corpus(path)
            all_pairs.extend(pairs)
            sources_loaded.append(f"{path.name}: {len(pairs)} cases")
        else:
            print(f"WARNING: {path} not found, skipping")

    inline = inline_category_example_pairs()
    all_pairs.extend(inline)
    sources_loaded.append(f"inline category examples: {len(inline)} examples")

    print("\n=== Data Sources ===")
    for s in sources_loaded:
        print(f"  {s}")
    print(f"  TOTAL (with duplicates): {len(all_pairs)}")

    # Deduplicate by (prompt, label) — keep first occurrence
    seen: set[tuple[str, str]] = set()
    deduped = []
    for pair in all_pairs:
        if pair not in seen:
            seen.add(pair)
            deduped.append(pair)

    # Also deduplicate by prompt alone (different labels = keep first)
    prompt_seen: set[str] = set()
    final = []
    for prompt, label in deduped:
        if prompt not in prompt_seen:
            prompt_seen.add(prompt)
            final.append((prompt, label))

    print(f"  TOTAL (deduplicated): {len(final)}")

    label_counts: dict[str, int] = {}
    for _, label in final:
        label_counts[label] = label_counts.get(label, 0) + 1
    print(f"  Class distribution: {label_counts}")
    return final


# ============================================================================
# Training
# ============================================================================


def make_lr(C: float, class_weight: str | dict | None = "balanced") -> LogisticRegression:
    # liblinear is more numerically stable than lbfgs for binary classification,
    # especially at high C values where lbfgs overflows on unit-norm embeddings.
    # class_weight='balanced' compensates for fix:general imbalance (~1:3.7)
    return LogisticRegression(C=C, solver="liblinear", max_iter=1000, random_state=42, class_weight=class_weight)


def train_lr(
    X: np.ndarray,
    y: np.ndarray,
    C: float,
) -> LogisticRegression:
    clf = make_lr(C)
    clf.fit(X, y)
    return clf


def cross_validate(
    X: np.ndarray,
    y: np.ndarray,
    C: float,
    n_folds: int = CV_FOLDS,
) -> tuple[float, float]:
    """Returns (train_accuracy, cv_accuracy)."""
    clf = make_lr(C)
    cv = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)
    cv_scores = cross_val_score(clf, X, y, cv=cv, scoring="accuracy")
    clf.fit(X, y)
    train_acc = clf.score(X, y)
    return train_acc, float(cv_scores.mean())


def grid_search_C(
    X: np.ndarray,
    y: np.ndarray,
    c_values: list[float],
) -> tuple[float, float]:
    """Two-stage grid search: coarse pass then fine refinement around best C."""
    best_C = c_values[0]
    best_cv_acc = -1.0
    print("\n=== Grid Search over C (coarse) ===")
    for C in c_values:
        _, cv_acc = cross_validate(X, y, C)
        print(f"  C={C:8.3f}  CV accuracy: {cv_acc:.4f}")
        if cv_acc > best_cv_acc:
            best_cv_acc = cv_acc
            best_C = C
    print(f"  Coarse best C: {best_C} (CV acc: {best_cv_acc:.4f})")

    # Fine-grained refinement: search around the coarse best
    idx = c_values.index(best_C)
    lo = c_values[idx - 1] if idx > 0 else best_C / 10
    hi = c_values[idx + 1] if idx < len(c_values) - 1 else best_C * 10
    fine_values = sorted({
        round(v, 4)
        for v in np.geomspace(lo, hi, num=8).tolist()
        if v != best_C
    })
    if fine_values:
        print(f"\n=== Grid Search over C (fine: {lo:.3f}–{hi:.3f}) ===")
        for C in fine_values:
            _, cv_acc = cross_validate(X, y, C)
            print(f"  C={C:8.4f}  CV accuracy: {cv_acc:.4f}")
            if cv_acc > best_cv_acc:
                best_cv_acc = cv_acc
                best_C = C

    print(f"  Best C: {best_C} (CV acc: {best_cv_acc:.4f})")
    return best_C, best_cv_acc


def apply_pca(
    X: np.ndarray,
    n_components: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fit PCA and return (X_reduced, components, mean)."""
    pca = PCA(n_components=n_components, random_state=42)
    X_reduced = pca.fit_transform(X)
    return X_reduced, pca.components_, pca.mean_


# ============================================================================
# Export
# ============================================================================


def build_artifact(
    clf: LogisticRegression,
    label_encoder: LabelEncoder,
    train_size: int,
    train_acc: float,
    cv_acc: float,
    best_C: float,
    pca_components: np.ndarray | None,
    pca_mean: np.ndarray | None,
    pca_dims: int | None,
    pca_variance_retained: float | None,
    report: dict,
    threshold: float = 0.5,
) -> dict:
    fix_label = "fix"
    general_label = "general"

    # label_encoder maps string labels to integers (alphabetical order):
    #   'fix' -> 0, 'general' -> 1
    # clf.classes_ contains [0, 1] (integer-encoded).
    # sklearn binary LR treats classes_[1] as the "positive" class.
    # coef_[0] gives log-odds coefficients for classes_[1] (encoded as 1 = 'general').
    # We want sigmoid(dot(emb, W) + b) > 0.5 to mean FIX.
    # Since fix_encoded=0 and general_encoded=1, fix is classes_[0], general is classes_[1].
    # Therefore: negate coef_[0] and intercept_[0] to get log-odds for fix.
    classes = list(label_encoder.classes_)
    if fix_label not in classes:
        raise ValueError(f"'fix' not in label encoder classes: {classes}")

    fix_encoded = label_encoder.transform([fix_label])[0]
    general_encoded = label_encoder.transform([general_label])[0]

    if len(clf.classes_) != 2:
        raise ValueError(f"Expected binary classifier, got classes: {clf.classes_}")

    # clf.classes_[1] is the "positive" class (higher encoded value)
    # Since fix=0 and general=1, clf.classes_[1]=1=general is positive.
    # coef_[0] predicts general; we negate to get fix probability.
    if fix_encoded < general_encoded:
        weights = (-clf.coef_[0]).tolist()
        bias = float(-clf.intercept_[0])
    else:
        weights = clf.coef_[0].tolist()
        bias = float(clf.intercept_[0])

    # Absorb tuned threshold into bias so inference uses a simple > 0.5 check.
    # sigmoid(z) > threshold  ⟺  z > log(threshold/(1-threshold))
    # Shifting bias by -log(threshold/(1-threshold)) makes the new boundary 0.5.
    if threshold != 0.5:
        bias -= np.log(threshold / (1 - threshold))

    f1_fix = report.get(fix_label, {}).get("f1-score", 0.0)
    f1_general = report.get(general_label, {}).get("f1-score", 0.0)

    artifact: dict = {
        "weights": weights,
        "bias": bias,
        "pca": None,
        "metadata": {
            "trainSize": train_size,
            "accuracy": round(train_acc, 6),
            "cvAccuracy": round(cv_acc, 6),
            "f1Fix": round(f1_fix, 6),
            "f1General": round(f1_general, 6),
            "regularizationC": best_C,
            "threshold": 0.5,
            "tunedThreshold": round(threshold, 4),
            "pcaDimensions": pca_dims,
            "pcaVarianceRetained": round(pca_variance_retained, 6) if pca_variance_retained is not None else None,
            "trainedAt": datetime.now(timezone.utc).isoformat(),
        },
    }

    if pca_components is not None and pca_mean is not None:
        artifact["pca"] = {
            "components": pca_components.tolist(),
            "mean": pca_mean.tolist(),
        }

    if pca_dims is not None:
        print(
            f"\nWARNING: PCA reduced weights to {pca_dims} dims. "
            "The TS inference code (lr-classifier.ts) expects exactly 1536 dims and will throw on this artifact. "
            "Update the dimension check and implement the PCA transform in classify() before deploying."
        )

    return artifact


# ============================================================================
# Main
# ============================================================================


def main() -> None:
    parser = argparse.ArgumentParser(description="Train LR classifier on OpenAI embeddings")
    parser.add_argument("--no-cache", action="store_true", help="Ignore embedding cache")
    parser.add_argument(
        "--output",
        default=None,
        help="Output path for model weights JSON (default: ./weights/lr-embedding-weights-<UTCstamp>.json)",
    )
    args = parser.parse_args()

    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    weights_dir = Path.cwd() / "weights"
    cache_path = weights_dir / "train-lr-embedding-cache.json"
    if args.output:
        output_path = Path(args.output)
    else:
        weights_dir.mkdir(parents=True, exist_ok=True)
        output_path = weights_dir / f"lr-embedding-weights-{run_stamp}.json"

    api_key = os.environ.get("OPENAI_API_KEY")
    base_url = (os.environ.get("OPENAI_BASE_URL") or "").strip() or GOCODE_BASE_URL

    if not api_key:
        print("ERROR: OPENAI_API_KEY not set.", file=sys.stderr)
        sys.exit(1)

    client = OpenAI(api_key=api_key, base_url=base_url)
    print(f"OpenAI client base_url: {base_url}")

    # --- Load data ---
    pairs = load_all_data()
    if len(pairs) < 50:
        print(f"ERROR: Only {len(pairs)} training examples found — need at least 50")
        sys.exit(1)

    prompts = [p for p, _ in pairs]
    raw_labels = [l for _, l in pairs]

    if not args.no_cache:
        weights_dir.mkdir(parents=True, exist_ok=True)

    # --- Embed ---
    cache = {} if args.no_cache else load_cache(cache_path)
    embeddings = fetch_embeddings(
        prompts,
        client,
        cache,
        cache_path=None if args.no_cache else cache_path,
        batch_size=100,
    )

    if len(embeddings) != len(prompts):
        print(f"ERROR: Got {len(embeddings)} embeddings for {len(prompts)} prompts")
        sys.exit(1)

    X = np.array(embeddings, dtype=np.float64)

    # Sanitize: replace inf/NaN with 0, then L2-normalize each row
    bad_mask = ~np.isfinite(X)
    if bad_mask.any():
        bad_rows = np.where(bad_mask.any(axis=1))[0]
        print(f"WARNING: {len(bad_rows)} embeddings contain inf/NaN — zeroing bad values")
        X[bad_mask] = 0.0
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    X = X / norms

    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(raw_labels)
    classes = list(label_encoder.classes_)
    print(f"\nLabel encoding: {dict(zip(classes, range(len(classes))))}")
    print(f"Training matrix: {X.shape}, labels: {y.shape}")

    # --- Grid search for best C (no PCA first) ---
    best_C, best_cv_acc_no_pca = grid_search_C(X, y, C_VALUES)
    train_acc, cv_acc = cross_validate(X, y, best_C)

    print(f"\n=== Baseline Results (no PCA, C={best_C}) ===")
    print(f"  Train accuracy: {train_acc:.4f}")
    print(f"  CV accuracy:    {cv_acc:.4f}")
    print(f"  Overfitting gap: {train_acc - cv_acc:.4f} (threshold: {OVERFITTING_THRESHOLD})")

    use_pca = (train_acc - cv_acc) > OVERFITTING_THRESHOLD
    pca_components_arr: np.ndarray | None = None
    pca_mean_arr: np.ndarray | None = None
    pca_dims_used: int | None = None
    pca_variance_retained: float | None = None
    X_train = X

    if use_pca:
        print(f"\n⚠ Overfitting detected (gap={train_acc - cv_acc:.4f} > {OVERFITTING_THRESHOLD}). Trying PCA...")
        best_pca_cv_acc = -1.0
        best_pca_dims = PCA_DIMS[0]
        best_pca_components = None
        best_pca_mean = None

        for n_dims in PCA_DIMS:
            X_reduced, components, mean = apply_pca(X, n_dims)
            _, cv_acc_pca = grid_search_C(X_reduced, y, C_VALUES)
            train_acc_pca, _ = cross_validate(X_reduced, y, best_C)
            gap = train_acc_pca - cv_acc_pca
            print(f"  PCA({n_dims}): train={train_acc_pca:.4f}, CV={cv_acc_pca:.4f}, gap={gap:.4f}")
            if cv_acc_pca > best_pca_cv_acc:
                best_pca_cv_acc = cv_acc_pca
                best_pca_dims = n_dims
                best_pca_components = components
                best_pca_mean = mean

        print(f"\nSelected PCA dims: {best_pca_dims} (CV acc: {best_pca_cv_acc:.4f})")
        X_reduced, pca_components_arr, pca_mean_arr = apply_pca(X, best_pca_dims)

        # Compute variance retained
        pca_model = PCA(n_components=best_pca_dims, random_state=42)
        pca_model.fit(X)
        pca_variance_retained = float(pca_model.explained_variance_ratio_.sum())

        X_train = X_reduced
        pca_dims_used = best_pca_dims

        # Re-run grid search on reduced data
        best_C, _ = grid_search_C(X_train, y, C_VALUES)
        train_acc, cv_acc = cross_validate(X_train, y, best_C)
        print(f"\n=== Results after PCA({pca_dims_used}), C={best_C} ===")
        print(f"  Train accuracy: {train_acc:.4f}")
        print(f"  CV accuracy:    {cv_acc:.4f}")
        print(f"  PCA variance retained: {pca_variance_retained:.4f}")
    else:
        print("\n✓ No significant overfitting detected. Proceeding without PCA.")

    # --- Final model ---
    clf = train_lr(X_train, y, best_C)

    # --- CV predictions for classification report ---
    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=42)
    y_pred_cv = cross_val_predict(make_lr(best_C), X_train, y, cv=cv)
    y_pred_labels = label_encoder.inverse_transform(y_pred_cv)
    y_true_labels = label_encoder.inverse_transform(y)

    # --- Threshold tuning (optimize fix F1 via CV probabilities) ---
    fix_encoded = int(label_encoder.transform(["fix"])[0])
    y_proba_cv = cross_val_predict(make_lr(best_C), X_train, y, cv=cv, method="predict_proba")
    fix_proba = y_proba_cv[:, fix_encoded]

    print("\n=== Threshold Tuning (fix F1) ===")
    best_threshold = 0.5
    best_fix_f1 = -1.0
    for thresh in np.arange(0.30, 0.71, 0.02):
        y_thresh = np.where(fix_proba >= thresh, fix_encoded, 1 - fix_encoded)
        fix_f1 = f1_score(y, y_thresh, pos_label=fix_encoded)
        print(f"  threshold={thresh:.2f}  fix_F1={fix_f1:.4f}")
        if fix_f1 > best_fix_f1:
            best_fix_f1 = fix_f1
            best_threshold = float(thresh)
    print(f"  Best threshold: {best_threshold:.2f} (fix F1: {best_fix_f1:.4f})")

    # Apply tuned threshold to CV predictions for the final report
    y_pred_tuned = np.where(fix_proba >= best_threshold, fix_encoded, 1 - fix_encoded)
    y_pred_labels = label_encoder.inverse_transform(y_pred_tuned)

    report_str = classification_report(y_true_labels, y_pred_labels)
    report_dict = classification_report(y_true_labels, y_pred_labels, output_dict=True)
    cm = confusion_matrix(y_true_labels, y_pred_labels, labels=classes)

    print(f"\n=== Classification Report (CV predictions) ===")
    print(report_str)
    print(f"=== Confusion Matrix (rows=true, cols=predicted) ===")
    print(f"  Labels: {classes}")
    print(f"  {cm}")

    label_counts = {label: int((y == i).sum()) for i, label in enumerate(classes)}
    print(f"\n=== Class Balance ===")
    for label, count in label_counts.items():
        print(f"  {label}: {count}")

    # --- Misclassification analysis ---
    # Sort by distance from threshold so confident errors (likely labeling
    # issues) and near-misses (would benefit from Haiku tiebreaker) are visible.
    misclassified = [
        (prompts[i], y_true_labels[i], y_pred_labels[i], float(fix_proba[i]))
        for i in range(len(y))
        if y_true_labels[i] != y_pred_labels[i]
    ]
    if misclassified:
        fix_to_general = [m for m in misclassified if m[1] == "fix"]
        general_to_fix = [m for m in misclassified if m[1] == "general"]

        # Sort each group by distance from threshold (closest first = best
        # tiebreaker candidates; furthest last = most confident errors)
        fix_to_general.sort(key=lambda m: best_threshold - m[3])
        general_to_fix.sort(key=lambda m: m[3] - best_threshold)

        # Tiebreaker zone: probabilities within ±0.15 of threshold are ambiguous
        # enough that an LLM tiebreaker has a realistic chance of correcting
        tiebreaker_band = 0.15

        print(f"\n=== Misclassified Examples ({len(misclassified)} total) ===")
        print(f"  fix_p = P(fix)  |  threshold = {best_threshold:.2f}  |  tiebreaker zone = ±{tiebreaker_band}")

        if fix_to_general:
            in_band = sum(1 for m in fix_to_general if best_threshold - m[3] <= tiebreaker_band)
            print(f"\n  --- fix → general ({len(fix_to_general)} errors, {in_band} in tiebreaker zone) ---")
            for prompt_text, _, _, p in fix_to_general:
                marker = "*" if best_threshold - p <= tiebreaker_band else " "
                print(f"   {marker} fix_p={p:.3f}  {prompt_text[:100]}")

        if general_to_fix:
            in_band = sum(1 for m in general_to_fix if m[3] - best_threshold <= tiebreaker_band)
            print(f"\n  --- general → fix ({len(general_to_fix)} errors, {in_band} in tiebreaker zone) ---")
            for prompt_text, _, _, p in general_to_fix:
                marker = "*" if p - best_threshold <= tiebreaker_band else " "
                print(f"   {marker} fix_p={p:.3f}  {prompt_text[:100]}")

        print(f"\n  (* = within ±{tiebreaker_band} of threshold; tiebreaker likely to help)")

    # --- Build artifact ---
    artifact = build_artifact(
        clf=clf,
        label_encoder=label_encoder,
        train_size=len(y),
        train_acc=train_acc,
        cv_acc=cv_acc,
        best_C=best_C,
        pca_components=pca_components_arr,
        pca_mean=pca_mean_arr,
        pca_dims=pca_dims_used,
        pca_variance_retained=pca_variance_retained,
        report=report_dict,
        threshold=best_threshold,
    )

    # --- Save weights ---
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=2)

    meta = artifact["metadata"]
    print(f"\n=== Model Saved ===")
    print(f"  Output: {output_path}")
    print(f"  Train size: {meta['trainSize']}")
    print(f"  Train accuracy: {meta['accuracy']:.4f}")
    print(f"  CV accuracy: {meta['cvAccuracy']:.4f}")
    print(f"  F1 fix: {meta['f1Fix']:.4f}")
    print(f"  F1 general: {meta['f1General']:.4f}")
    print(f"  Regularization C: {meta['regularizationC']}")
    print(f"  Decision threshold: {meta['threshold']}")
    print(f"  PCA dimensions: {meta['pcaDimensions']}")
    print(f"  Trained at: {meta['trainedAt']}")

    # --- Save JSON report ---
    report_path = output_path.parent / f"lr-training-report-{run_stamp}.json"
    full_report = {
        "classificationReport": report_dict,
        "confusionMatrix": {"labels": classes, "matrix": cm.tolist()},
        "classBalance": label_counts,
        "metadata": meta,
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(full_report, f, indent=2)
    print(f"  Report: {report_path}")


if __name__ == "__main__":
    main()
