# Painter

Prosta przeglądarka zdjęć na macOS (Electron + React). Pokazuje foldery i zdjęcia jako miniatury. Pozwala obejrzeć zdjęcie w powiększeniu, wykadrować je, skopiować, wydrukować albo przenieść do Kosza.

Obsługiwane formaty: JPG, PNG, GIF, WebP, BMP, TIFF, HEIC/HEIF, SVG. Kadrowanie działa dla JPG, PNG i WebP.

## Funkcje

- **Przeglądanie folderów:** siatka miniatur i ścieżka okruszków. Aplikacja pamięta ostatni folder (na start otwiera Obrazki).
- **Podgląd zdjęcia:** powiększanie, oddalanie i przechodzenie do poprzedniego lub następnego zdjęcia.
- **Kadrowanie** w dwóch trybach:
  - *Kadruj szybko:* przeciągasz po zdjęciu, a kadr zapisuje się od razu.
  - *Kadruj dokładnie:* ustawiasz każdy bok i zatwierdzasz.

  Kadr nadpisuje oryginalny plik. Jeśli chcesz zachować oryginał, najpierw zrób kopię.
- **Kopia:** duplikat z dopiskiem „-kopia” w tym samym folderze.
- **Druk:** z zachowaniem proporcji albo rozciągnięty na całą kartkę. Orientacja kartki dobiera się do zdjęcia.
- **Usuwanie:** przenosi plik do Kosza, nie kasuje go na stałe.
- **Integracja z Finderem:** Painter jest na liście „Otwórz za pomocą” dla obrazów. Bieżący folder można otworzyć w Finderze.
- **Automatyczne aktualizacje:** przy starcie aplikacja sprawdza, czy na GitHubie jest nowsza wersja (szczegóły niżej).

## Skróty klawiszowe

| Skrót | Działanie |
| --- | --- |
| ⌘↑ (lub ⌥↑) | Folder wyżej |
| ⌘⇧D | Pulpit |
| ← / → | Poprzednie / następne zdjęcie |
| + / − | Przybliż / oddal |
| ⌘P | Drukuj |
| Enter | Zatwierdź kadr (tryb dokładny) |
| Esc | Anuluj kadrowanie / zamknij podgląd |

## Instalacja

1. Pobierz `Painter-<wersja>-arm64-mac.dmg` (albo `.zip`) z [najnowszego wydania](https://github.com/g-krzysztof/painter/releases/latest).
2. Przenieś `Painter.app` do folderu **Programy**.
3. Aplikacja nie jest podpisana certyfikatem Apple, więc przy pierwszym uruchomieniu kliknij ją prawym przyciskiem i wybierz **Otwórz**. Możesz też zdjąć kwarantannę z terminala:
   ```sh
   xattr -cr /Applications/Painter.app
   ```

Wydania są budowane tylko dla Maców z procesorem Apple Silicon (arm64).

## Aktualizacje

Przy każdym starcie Painter sprawdza najnowsze wydanie w tym repozytorium. Jeśli jest nowsza wersja, pyta, czy ją zainstalować. Po zgodzie:

1. pobiera zip,
2. zamyka się,
3. podmienia `Painter.app`,
4. uruchamia się ponownie.

Żeby to działało:

- aplikacja musi leżeć w folderze, do którego masz prawo zapisu (zwykle **Programy**). Nie może działać prosto z Pobranych ani z obrazu dmg,
- repozytorium musi być publiczne.

Jeśli instalacja się nie uda, aplikacja zaproponuje otwarcie strony wydania, skąd pobierzesz nową wersję ręcznie.

## Rozwój

Wymagania: macOS, Node.js, npm.

```sh
npm install        # instaluje zależności (skrypt postinstall naprawia rozpakowanie Electrona)
npm run dev        # uruchamia aplikację w trybie deweloperskim z przeładowaniem na żywo
npm run typecheck  # sprawdza typy TypeScript
npm run dist:mac   # buduje Painter.app do dist/mac-arm64 (bez instalatora)
```

W trybie deweloperskim aplikacja nie sprawdza aktualizacji.

### Struktura

```
src/
  main/       proces główny Electrona: okno, operacje na plikach, miniatury, aktualizacje
  preload/    API udostępniane stronie (window.api)
  renderer/   interfejs w React
  shared/     typy i stałe wspólne dla obu stron
scripts/      skrypty pomocnicze (fix-electron.mjs)
```

## Wydawanie nowej wersji

Jednorazowo zainstaluj [GitHub CLI](https://cli.github.com) i zaloguj się:

```sh
brew install gh
gh auth login
```

Potem przy każdym wydaniu:

1. Podbij `version` w `package.json`, np. `0.1.0` → `0.2.0`. Zrób commit i push.
2. Zbuduj i opublikuj wydanie:
   ```sh
   npm run release:mac
   ```
   Skrypt `scripts/release.sh` buduje zip i dmg, tworzy wydanie `v<wersja>` na GitHubie i dołącza do niego oba pliki.
3. Zainstalowane kopie zaproponują aktualizację przy najbliższym uruchomieniu.

Repozytorium, z którego aplikacja pobiera aktualizacje, jest ustawione w `REPO` w `src/main/updater.ts`.
