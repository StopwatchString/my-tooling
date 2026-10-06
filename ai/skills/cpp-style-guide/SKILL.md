---
name: cpp-style-guide
description: "REQUIRED before writing, editing, reviewing, or planning ANY C++ code (.h, .hpp, .cpp, .cc, .cxx), even a one-line change. The user's personal C++23 rules: fixed-width ints, no auto, no exceptions (std::optional/std::expected), Doxygen comments, include order, enum/class/struct templates, m_ members, _g suffix for functions touching outer state. Clang diagnostics and compiler warnings always override it; a project's dominant existing style usually does too."
---

# Personal C++ Style Guide

## Precedence
1. Clang diagnostics and compiler warnings always win over anything in this guide. That includes clangd and clang-tidy findings. If a rule here would produce a warning, follow the warning instead.
2. When a project has a pre-existing style that is clearly dominant and contradicts these rules, defer to the project. If it's unclear whether the project's style should win, ask the user before choosing.
3. Otherwise, follow this guide.

Don't rewrite existing code to fit this style unless asked. Matching the surrounding code matters most.

## General
- Target C++23.
- Use `<cstdint>` fixed-width integer types wherever possible. They're required unless it's unclear whether they match an API you can't change. When inheriting values from an API, converting them to fixed-width types is encouraged if no information is lost.
- `auto` is forbidden except where the language requires it. The one exception: an iterator that's named obviously and used immediately.

## Documentation
- All comments are Doxygen-style. `@brief`, `@param`, and `@return` are required when relevant.
- Keep `@brief` concise and scoped to the function itself unless more is absolutely necessary.
- A `.cpp` implementation of a function declared in a header needs no comment. Add comments only for implementation-specific notes.

## Namespaces
- `using namespace X` is disallowed everywhere, including `using namespace std`.

## Headers and implementation files
Headers are `.h` and implementation files are `.cpp`.
- Headers use `#ifndef` include guards.
- A `.cpp` that implements a header **must** start with `#include "path/to/header.h"` followed by a blank line.
- Use `""` for project and third-party includes. `<>` is only for system headers.
- File-local functions and symbols **must** be in an anonymous namespace.
- Include order: project headers, then third-party headers, then system headers.

## Exceptions
- Exceptions are disallowed in all code we control. Report errors with `std::optional<>` and `std::expected<>`.
- When a standard library function has both a throwing version and an error-code version, ALWAYS use the error-code version.
- If a third-party library has an exception-free mode, use it.
- Enable `-fno-exceptions` when possible. Most projects can't, because of their dependencies.
- Use `try`/`catch` only at API boundaries that can throw, to turn the exception into a local error value.

## Functions
- A function that can fail reports it with `std::optional<>`, not a sentinel return value. The exception is performance-critical code.
- Out parameters are discouraged.
- If it's obvious that a return value should never be ignored, mark the function `[[nodiscard]]`.
- Functions avoid touching state not passed to them explicitly. A function that touches a variable from an outer scope must name *what* it touches in its Doxygen comment, and its name must end in `_g`.
- Prefer passing the larger state by reference over reaching for it from outside local scope.

## Memory and pointers
- Explicit `new` and `delete` are forbidden unless an API you can't control requires them.
- `std::unique_ptr<>` is the default for heap allocations.
- When a pointer crosses a function boundary, the callee is usually responsible for checking it. Either:
    - The function assumes the pointer is always valid, doesn't check it, and **must** `assert(ptr != nullptr);`, or
    - The function branches on whether the pointer is valid, and MUST handle both cases correctly.

## Enums
- `enum class`, not `enum`.
- State the underlying type explicitly. `int8_t` is usually a reasonable start.
- The first member is `Unset = 0` and the last is `Size`, so every value of `enum class Foo` lies in `[Foo::Unset, Foo::Size)`.
- Assign no values after `Unset = 0`, so the rest count up by one.
- Enum names and values are PascalCase.
- Pair every enum `E` with two `constexpr`-capable functions:
    - `std::string_view enum_to_string(const E e)`: a `switch` that returns a `std::string_view` to a static, lowercase name for the value.
    - `std::optional<E> string_to_enum(std::string_view s)`: converts a string to `E` if it can.
- Bit flag enums may bend these rules as needed.

```cpp
enum class Color : int8_t {
    Unset = 0,
    Red,
    Green,
    Size,
};
```

## std::vector
- Always `reserve()` or `resize()` up front when you can reasonably estimate the size. If you can't, you *must* `reserve(4)` at declaration.
- Prefer `emplace_back()` over `push_back()` for non-primitive element types.

## Strings
- Use `std::string_view` for immutable string views when possible.
- Pass `std::string` only by `const&` unless unavailable. If the function needs a copy, make it explicitly inside the function instead of taking the string by value.
- Declare static strings as `std::string_view`, not `const char*`, unless that's inconvenient.
- Print to the console with `std::cout << std::format(...)`.

## Classes
- Start every class from this template. The default constructor, destructor, copy pair, and move pair must always be declared, and each is implemented, `= default`, or `= delete`. The copy constructor and copy assignment must match each other, and so must the move pair.

```cpp
class Foo final {
public:
    Foo();
    ~Foo();

    Foo(const Foo& other);
    Foo& operator=(const Foo& other);

    Foo(Foo&& other) noexcept;
    Foo& operator=(Foo&& other) noexcept;
private:
};
```

- Move assignment checks for self-assignment: `if (this != &other) { /* move logic */ }`
- Declare classes `final` unless they're designed up front to be extended. A class that isn't `final` **must** have a `virtual` destructor.
- Member names are prefixed `m_`.
- Order sections `public`, `protected`, `private`. Avoid `protected` members when possible.
- These class rules don't apply to structs.

### Validated classes (preferred when possible)
Construction is validated and can fail. Constructors are private (they may take any parameters, and no default constructor is required), and the only way to get an object is a static factory that returns `std::optional<>`. The factory must only ever return a valid object.

```cpp
class Foo final {
    Foo(...); // private
public:
    static std::optional<Foo> create(...);
};
```

## Structs
- Structs **MUST** only be POD data types. Member functions and access specifiers are strictly prohibited.
