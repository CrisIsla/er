import { Box, Spinner, Button } from "@chakra-ui/react";
import Editor, { OnMount, useMonaco } from "@monaco-editor/react";
import { editor, languages } from "monaco-types";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { getERDoc } from "../../../ERDoc";
import {
  ErrorMessage,
  MarkerSeverity,
  ErDocChangeEvent,
} from "../../types/CodeEditor";
import { colors } from "../../util/colors";
import getErrorMessage from "../../util/errorMessages";
import { EditorHeader } from "./EditorHeader";
import ExamplesTable from "./ExamplesTable";
import ErrorTable from "./ErrorTable";
import { fetchExample } from "../../util/common";
import { useJSON } from "../../hooks/useJSON";

const DEFAULT_EXAMPLE = "company";

type ErrorReportingEditorProps = {
  onErDocChange: (evt: ErDocChangeEvent) => void;
  onErrorChange: (hasError: boolean) => void;
};

const editorThemes: [themeName: string, theme: editor.IStandaloneThemeData][] =
  [
    [
      "onedark",
      {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword", foreground: colors.textEditorAccent },
          { token: "string", foreground: "#98c379" },
        ],
        colors: {
          "editor.background": "#21252b",
        },
      },
    ],
    [
      "light",
      {
        base: "vs",
        inherit: true,
        rules: [
          { token: "keyword", foreground: "#9811e6" },
          { token: "string", foreground: "#69aa39" },
        ],
        colors: {
          "editor.background": "#ffffff",
          "editor.foreground": "#000000",
        },
      },
    ],
  ];

const DEFAULT_THEME = "onedark";
const LIGHT_THEME = "light";

const erdocConfig: languages.LanguageConfiguration = {
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
  ],
};

const erdocTokenizer: languages.IMonarchLanguage = {
  keywords: ["entity", "relation", "aggregation", "depends on", "extends"],
  keyKeywords: ["key", "pkey"],
  ignoreCase: true,
  tokenizer: {
    root: [
      // identifiers and keywords
      [
        /depends[ ]on|[a-z_][\w]*/,
        {
          cases: {
            "@keywords": "keyword",
            "@keyKeywords": "string",
          },
        },
      ],

      [
        /\w+\s\w+/,
        {
          cases: {
            "@keywords": "keyword",
          },
        },
      ],
    ],
  },
};

const LOCAL_STORAGE_EDITOR_CONTENT_KEY = "monaco-editor-content";

const CodeEditor = ({
  onErDocChange,
  onErrorChange,
}: ErrorReportingEditorProps) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const thisEditor = useMonaco();
  const semanticErrT = useTranslations("home.codeEditor.semanticErrorMessages");
  const [errorMessages, setErrorMessages] = useState<ErrorMessage[]>([]);
  const { importJSON } = useJSON(onErDocChange);
  const searchParams = useSearchParams();
  const [currentTheme, setCurrentTheme] = useState(DEFAULT_THEME);

  const toggleTheme = () => {
    const newTheme =
      currentTheme === DEFAULT_THEME ? LIGHT_THEME : DEFAULT_THEME;
    setCurrentTheme(newTheme);
    thisEditor?.editor.setTheme(newTheme);
  };

  const setEditorErrors = (
    errorMessages: ErrorMessage[],
    severity: MarkerSeverity,
    monacoInstance: ReturnType<typeof useMonaco>,
  ) => {
    if (!editorRef.current) return;

    const errors: editor.IMarkerData[] = errorMessages.map((err) => ({
      startLineNumber: err.location.start.line,
      startColumn: err.location.start.column,
      endLineNumber: err.location.end.line,
      endColumn: err.location.end.column,
      message: err.errorMessage,
      severity,
    }));
    monacoInstance?.editor.setModelMarkers(
      editorRef.current.getModel()!,
      "semanticErrors",
      errors,
    );
  };

  const handleEditorContent = (
    content: string,
    monacoInstance = thisEditor,
  ) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_EDITOR_CONTENT_KEY, content);
      const [erDoc, errors] = getERDoc(content);
      onErrorChange(errors.length > 0);
      onErDocChange({ er: erDoc, type: "userInput" });
      const errorMsgs: ErrorMessage[] = errors.map((err) => ({
        errorMessage: getErrorMessage(semanticErrT, err),
        location: err.location,
      }));
      setEditorErrors(errorMsgs, MarkerSeverity.Error, monacoInstance);
      setErrorMessages(errorMsgs);
    } catch (e) {
      onErrorChange(true);
      const syntaxErrorMessage = {
        errorMessage: e.message,
        location: e.location,
      };
      setErrorMessages([syntaxErrorMessage]);
      setEditorErrors(
        [syntaxErrorMessage],
        MarkerSeverity.Error,
        monacoInstance,
      );
    }
  };

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    const prevContent = localStorage.getItem(LOCAL_STORAGE_EDITOR_CONTENT_KEY);
    // an example named in the URL is what the user asked to see, so it wins over
    // both the cached document and the default one; page.tsx loads it as soon as
    // this editor exists
    const wantsExample = searchParams.get("example") !== null;
    if (wantsExample) {
      // nothing to do: leave the model empty for the example to fill
    } else if (prevContent === null) {
      // load an example from api
      fetchExample(DEFAULT_EXAMPLE)
        .then((example) => {
          if (example) {
            importJSON(example, monacoInstance);
          }
        })
        .catch((err) => console.error(err));
    } else {
      editor.setValue(prevContent);
      handleEditorContent(prevContent, monacoInstance);
    }
    // mount erdoc language
    monacoInstance.languages.register({ id: "erdoc" });
    monacoInstance.languages.setMonarchTokensProvider("erdoc", erdocTokenizer);
    monacoInstance.languages.setLanguageConfiguration("erdoc", erdocConfig);
    // custom themes
    for (const [themeName, theme] of editorThemes) {
      monacoInstance.editor.defineTheme(themeName, theme);
    }
    monacoInstance.editor.setTheme(currentTheme);
  };

  return (
    <Box
      height={"full"}
      width={"full"}
      display={"flex"}
      flexDir={"column"}
      overflow={"hidden"}
    >
      <EditorHeader
        editorRef={editorRef}
        currentTheme={currentTheme}
        onToggleTheme={toggleTheme}
        modelName=""
      />
      <Box
        resize="none"
        pt={0}
        flex={"1 1 auto"}
        width="full"
        height="max-content"
        overflow="hidden"
        bg={colors.textEditorBackground}
      >
        <Editor
          height={"100%"}
          onChange={(content, _evt) => handleEditorContent(content!)}
          onMount={handleEditorMount}
          loading={<Spinner color="white" />}
          language="erdoc"
          options={{
            autoClosingBrackets: "always",
            scrollBeyondLastLine: false,
            fixedOverflowWidgets: true,
            minimap: {
              enabled: false,
            },
          }}
        />
      </Box>

      <Box
        height={"max-content"}
        maxHeight={"30%"}
        backgroundColor={colors.textEditorBackground}
      >
        <ErrorTable errors={errorMessages} />
      </Box>
      <Box
        height={"max-content"}
        maxHeight={"30%"}
        backgroundColor={colors.textEditorBackground}
      >
        <ExamplesTable onErDocChange={onErDocChange} />
      </Box>
    </Box>
  );
};

export default CodeEditor;
