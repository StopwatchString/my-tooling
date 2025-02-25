#include <gtest/gtest.h>

#include "Component.hpp"

TEST(ComponentTest, PrintCounting) {
    Component c;

    EXPECT_EQ(0, c.getPrintCount());

    c.print();

    EXPECT_EQ(1, c.getPrintCount());

    c.print();

    EXPECT_EQ(2, c.getPrintCount());
}
