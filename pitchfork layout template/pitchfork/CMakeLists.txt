cmake_minimum_required(VERSION 3.30)

# Globals
set(PROJECT_NAME "ProjectName")
set(TARGET_NAME "TargetName")

project(${PROJECT_NAME})

# Environment settings
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# List all project source in these variables
set(SOURCES
    ${CMAKE_SOURCE_DIR}/src/Component.cpp
    ${CMAKE_SOURCE_DIR}/src/namespace/SubComponent.cpp
    ${CMAKE_SOURCE_DIR}/src/PublicComponent.cpp
)
set(PRIVATE_HEADERS
    ${CMAKE_SOURCE_DIR}/src/Component.hpp
    ${CMAKE_SOURCE_DIR}/src/namespace/SubComponent.hpp
)
set(PUBLIC_HEADERS
    ${CMAKE_SOURCE_DIR}/include/PublicComponent.hpp
    ${CMAKE_SOURCE_DIR}/include/pubincl/TestComponentaa.hpp
)
# List all GTest files here
# Generally every hpp/cpp combo should have a matching [filename].test.cpp.
# Header-only should also receive test files.
set(TEST_SOURCES
    ${CMAKE_SOURCE_DIR}/src/Component.test.cpp
    ${CMAKE_SOURCE_DIR}/src/namespace/SubComponent.test.cpp
    ${CMAKE_SOURCE_DIR}/src/PublicComponent.test.cpp
)

# -------------- PROJECT LIBRARY --------------
# Create linkable library from project files
# We break this into a library so that the main exe and test project
# share the same artefacts
add_library(${TARGET_NAME}_lib ${SOURCES} ${PRIVATE_HEADERS} ${PUBLIC_HEADERS})
target_include_directories(
    ${TARGET_NAME}_lib
    PUBLIC  ${CMAKE_SOURCE_DIR}/include # All headers in /include should be public
    PRIVATE ${CMAKE_SOURCE_DIR}/src     # All headers in /src should be private
)

## External project linkage would go here

# ------------- PROJECT EXECUTABLE -------------
add_executable(${TARGET_NAME} src/main/main.cpp)
target_link_libraries(${TARGET_NAME} PRIVATE ${TARGET_NAME}_lib)

# ------------------ TESTING ------------------
# Add Google Test
add_subdirectory(external/googletest)

enable_testing()

add_executable(${TARGET_NAME}_tests ${TEST_SOURCES})
target_link_libraries(
    ${TARGET_NAME}_tests
    PRIVATE GTest::gtest_main
    PRIVATE ${TARGET_NAME}_lib
)
target_include_directories(
    ${TARGET_NAME}_tests
    # Explicitly access all headers, regardless of visibility from _lib
    PRIVATE ${CMAKE_SOURCE_DIR}/include
    PRIVATE ${CMAKE_SOURCE_DIR}/src
)

include(GoogleTest)
gtest_discover_tests(${TARGET_NAME}_tests)

# --------------- MSVC Settings ---------------
if (MSVC)
    # Organize Google Test targets into a subfolder in Visual Studio
    set_target_properties(gtest gtest_main gmock gmock_main
        PROPERTIES FOLDER "GoogleTest"
    )

    # Set Visual Studio startup project as our main target (normally VS will default to BUILD_ALL)
    set_property(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR} PROPERTY VS_STARTUP_PROJECT ${TARGET_NAME})

    # Enable Multiprocessor compile on targets
    target_compile_options(${TARGET_NAME}_lib PRIVATE /MP)
    target_compile_options(${TARGET_NAME} PRIVATE /MP)
    target_compile_options(${TARGET_NAME}_tests PRIVATE /MP)

    # Provides folder tree in visual studio filters
    source_group(TREE ${CMAKE_SOURCE_DIR}/src PREFIX "Source Files" FILES ${SOURCES})
    source_group(TREE ${CMAKE_SOURCE_DIR}/src PREFIX "Private Header Files" FILES ${PRIVATE_HEADERS})
    source_group(TREE ${CMAKE_SOURCE_DIR}/include PREFIX "Public Header Files" FILES ${PUBLIC_HEADERS})
endif()