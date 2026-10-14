"""
Internationalization (i18n) support for TTSFM Web Application

This module provides multi-language support for the Flask web application,
including language detection, translation management, and template functions.
"""

import json
import os
from typing import Any, Dict, Optional

from flask import request, session


class LanguageManager:
    """Manages language detection, translation loading, and text translation."""

    def __init__(self, app=None, translations_dir: str = "translations"):
        """
        Initialize the LanguageManager.

        Args:
            app: Flask application instance
            translations_dir: Directory containing translation files
        """
        self.translations_dir = translations_dir
        self.translations: Dict[str, Dict[str, Any]] = {}
        self.supported_languages = ["en", "zh"]
        self.default_language = "en"

        if app is not None:
            self.init_app(app)

    def init_app(self, app):
        """Initialize the Flask application with i18n support."""
        app.config.setdefault("LANGUAGES", self.supported_languages)
        app.config.setdefault("DEFAULT_LANGUAGE", self.default_language)

        # Load translations
        self.load_translations()

        # Register template functions
        app.jinja_env.globals["_"] = self.translate
        app.jinja_env.globals["get_locale"] = self.get_locale
        app.jinja_env.globals["get_supported_languages"] = self.get_supported_languages

        # Store reference to this instance
        app.language_manager = self

    def load_translations(self):
        """Load all translation files from the translations directory."""
        translations_path = os.path.join(os.path.dirname(__file__), self.translations_dir)

        if not os.path.exists(translations_path):
            print(f"Warning: Translations directory not found: {translations_path}")
            return

        for lang_code in self.supported_languages:
            file_path = os.path.join(translations_path, f"{lang_code}.json")

            if os.path.exists(file_path):
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        self.translations[lang_code] = json.load(f)
                    print(f"Info: Loaded translations for language: {lang_code}")
                except Exception as e:
                    print(f"Error: Failed to load translations for {lang_code}: {e}")
            else:
                print(f"Warning: Translation file not found: {file_path}")

    def get_locale(self) -> str:
        """
        Get the current locale based on user preference, session, or browser settings.

        Returns:
            Language code (e.g., 'en', 'zh')
        """
        # 1. Check URL parameter (for language switching)
        if "lang" in request.args:
            lang = request.args.get("lang")
            if lang in self.supported_languages:
                session["language"] = lang
                return lang

        # 2. Check session (user's previous choice)
        if "language" in session:
            lang = session["language"]
            if lang in self.supported_languages:
                return lang

        # 3. Check browser's Accept-Language header
        if request.headers.get("Accept-Language"):
            browser_langs = request.headers.get("Accept-Language").split(",")
            for browser_lang in browser_langs:
                # Extract language code (e.g., 'zh-CN' -> 'zh')
                lang_code = browser_lang.split(";")[0].split("-")[0].strip().lower()
                if lang_code in self.supported_languages:
                    session["language"] = lang_code
                    return lang_code

        # 4. Fall back to default language
        return self.default_language

    def set_locale(self, lang_code: str) -> bool:
        """
        Set the current locale.

        Args:
            lang_code: Language code to set

        Returns:
            True if successful, False if language not supported
        """
        if lang_code in self.supported_languages:
            session["language"] = lang_code
            return True
        return False

    def translate(self, key: str, **kwargs) -> str:
        """
        Translate a text key to the current locale.

        Args:
            key: Translation key in dot notation (e.g., 'nav.home')
            **kwargs: Variables for string formatting

        Returns:
            Translated text or the key if translation not found
        """
        locale = self.get_locale()

        # Get translation for current locale
        translation = self._get_nested_value(self.translations.get(locale, {}), key)

        # Fall back to default language if not found
        if translation is None and locale != self.default_language:
            translation = self._get_nested_value(
                self.translations.get(self.default_language, {}), key
            )

        # Fall back to key if still not found
        if translation is None:
            translation = key

        # Format with variables if provided
        if kwargs and isinstance(translation, str):
            try:
                translation = translation.format(**kwargs)
            except (KeyError, ValueError):
                pass  # Ignore formatting errors

        return translation

    def _get_nested_value(self, data: Dict[str, Any], key: str) -> Optional[str]:
        """
        Get a nested value from a dictionary using dot notation.

        Args:
            data: Dictionary to search in
            key: Dot-separated key (e.g., 'nav.home')

        Returns:
            Value if found, None otherwise
        """
        keys = key.split(".")
        current = data

        for k in keys:
            if isinstance(current, dict) and k in current:
                current = current[k]
            else:
                return None

        return current if isinstance(current, str) else None

    def get_supported_languages(self) -> Dict[str, str]:
        """
        Get a dictionary of supported languages with their display names.

        Returns:
            Dictionary mapping language codes to display names
        """
        return {"en": "English", "zh": "中文"}

    def get_language_info(self, lang_code: str) -> Dict[str, str]:
        """
        Get information about a specific language.

        Args:
            lang_code: Language code

        Returns:
            Dictionary with language information
        """
        language_names = {
            "en": {"name": "English", "native": "English"},
            "zh": {"name": "Chinese", "native": "中文"},
        }

        return language_names.get(
            lang_code, {"name": lang_code.upper(), "native": lang_code.upper()}
        )


# Global instance
language_manager = LanguageManager()


def init_i18n(app):
    """Initialize i18n support for the Flask application."""
    language_manager.init_app(app)
    return language_manager


# Template helper functions
def _(key: str, **kwargs) -> str:
    """Shorthand translation function for use in templates and code."""
    return language_manager.translate(key, **kwargs)


def get_locale() -> str:
    """Get the current locale."""
    return language_manager.get_locale()


def set_locale(lang_code: str) -> bool:
    """Set the current locale."""
    return language_manager.set_locale(lang_code)
